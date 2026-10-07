package ai.motif.reference;

import ai.motif.sdk.MotifClient;
import ai.motif.sdk.api.SdkApi;
import ai.motif.sdk.client.ApiClient;
import ai.motif.sdk.model.SdkClarityMarketUpdateRequest;
import ai.motif.sdk.model.SdkFeedsConfigureSubscriptionRequest;
import ai.motif.sdk.model.SdkAssetsList200ResponseAssetsInner;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import java.nio.file.Path;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.ConfigProvider;

@ApplicationScoped
public class ConnectorLifecycle {
    private final ObjectMapper mapper = ApiClient.createDefaultObjectMapper();
    public void run(String[] arguments) throws Exception {
        boolean apply = false;
        int listenSeconds = 60;
        for (String argument : arguments) {
            if (argument.equals("--apply")) apply = true;
            else if (argument.startsWith("--listen-seconds=")) listenSeconds = Integer.parseInt(argument.substring(17));
            else throw new IllegalArgumentException("Unknown option: " + argument);
        }
        System.out.println("https://motif.gitbook.io/motif-docs/integrate-with-motif/event-data-feeds");
        System.out.println("1. Subscribe\n2. Discover and map assets\n3. Publish master, prices and FX through the connector\n4. Read market and asset insights\n5. PUT portfolio\n6. Replace portfolio and read insight\n7. Receive publications and reconcile");
        if (!apply) { System.out.println("Preview only; use --apply against a provisioned sandbox with the connector running."); return; }
        if (listenSeconds < 0 || listenSeconds > 600) throw new IllegalArgumentException("listen-seconds must be 0–600");
        required("MOTIF_ORG_ID");
        SdkApi api = new MotifClient(required("MOTIF_API_KEY"), Configuration.sandboxUrl(value("MOTIF_API_BASE_URL", "https://staging.backend.motifapp.ai/api"))).api();
        String runId = "reference-" + UUID.randomUUID();
        var previous = api.sdkFeedsSubscription();
        var restore = mapper.convertValue(previous, SdkFeedsConfigureSubscriptionRequest.class);
        try (var broker = new PartnerBroker(Path.of(required("PARTNER_BROKER_URL_FILE")), Boolean.parseBoolean(value("MOTIF_LOCAL_BROKER", "false")), runId, mapper, publication -> readPublication(api, publication))) {
            try {
                api.sdkFeedsConfigureSubscription(mapper.convertValue(Map.of("enabled", true, "surfaces", List.of("MARKET", "ASSET", "PORTFOLIO"), "language", "en"), SdkFeedsConfigureSubscriptionRequest.class));
                String cursor = null;
                SdkAssetsList200ResponseAssetsInner apple = null;
                do {
                    var page = api.sdkAssetsList(cursor, 100, null, null);
                    for (var asset : page.getAssets()) {
                        if ("AAPL".equals(asset.getSymbol()) && "NASDAQ".equals(asset.getExchange()) && "EQUITY".equals(String.valueOf(asset.getCategory()))) {
                            if (apple != null) throw new IllegalStateException("Ambiguous listing");
                            apple = asset;
                        }
                    }
                    cursor = page.getNextCursor();
                } while (cursor != null);
                if (apple == null || apple.getExternalId() != null) throw new IllegalStateException("Resolve an unmapped AAPL NASDAQ listing in a clean sandbox");
                show("Verified catalog listing", apple);
                String appleReference = runId + "-apple";
                String fundReference = runId + "-fund";
                String asOf = OffsetDateTime.now(ZoneOffset.UTC).toString();
                broker.publish(runId + "-master-apple", "ai.motif.asset.master.v1", appleReference, Map.of("externalId", appleReference, "action", "MAP_EXISTING", "assetId", apple.getId(), "currency", "USD", "priceProvider", "MARKET", "asOf", asOf, "revision", 1));
                var fund = broker.publish(runId + "-master-fund", "ai.motif.asset.master.v1", fundReference, Map.of("externalId", fundReference, "action", "CREATE_CUSTOM", "name", "Private Fund A", "symbol", "PRIVATE-A", "currency", "USD", "priceProvider", "CUSTOM", "asOf", asOf, "revision", 1));
                String fundId = fund.path("resourceId").asText();
                if (fundId.isBlank()) throw new IllegalStateException("Missing asset ID in receipt");
                show("Stored mapping", api.sdkAssetsList(null, 50, null, appleReference));
                String priceId = runId + "-price";
                Map<String, Object> price = Map.of("externalId", fundReference, "unitPrice", "12.50", "currency", "USD", "priceType", "CLOSE", "adjustment", "UNADJUSTED", "asOf", asOf, "revision", 1);
                show("Applied price", broker.publish(priceId, "ai.motif.asset.price.v1", fundReference, price));
                show("Duplicate price", broker.publish(priceId, "ai.motif.asset.price.v1", fundReference, price));
                broker.publish(priceId + "-correction", "ai.motif.asset.price.v1", fundReference, Map.of("externalId", fundReference, "unitPrice", "13.00", "currency", "USD", "priceType", "CLOSE", "adjustment", "UNADJUSTED", "asOf", asOf, "revision", 2));
                broker.publish(runId + "-fx", "ai.motif.fx.rate.v1", "EUR/USD", Map.of("baseCurrency", "EUR", "quoteCurrency", "USD", "rate", "1.10", "rateType", "MID", "asOf", asOf, "revision", 1));
                show("Stored FX (not automatic conversion)", api.sdkFeedsFxRate("EUR", "USD", OffsetDateTime.parse(asOf)));
                show("Market update", api.sdkClarityMarketUpdate(new SdkClarityMarketUpdateRequest().language("en")));
                show("Asset insight", api.sdkClarityAssetById(apple.getId(), "en"));
                String account = runId + "-account-42-a";
                var first = api.sdkPortfoliosPut(account, Lifecycle.snapshot(1, apple.getId(), fundId));
                show("Portfolio receipt", first);
                waitForCalculation(api, account, 1);
                var second = Lifecycle.snapshot(2, apple.getId(), fundId);
                api.sdkPortfoliosPut(account, second);
                show("Duplicate portfolio snapshot", api.sdkPortfoliosPut(account, second));
                waitForCalculation(api, account, 2);
                show("Portfolio insight", api.sdkClarityPortfolioById(first.getPortfolioId(), "en", "1D"));
                show("Reconciled receipt", api.sdkFeedsReceipt(priceId, java.net.URI.create("urn:partner:" + runId)));
                int publications = broker.listen(listenSeconds);
                show("Publication observation", Map.of("publications", publications, "status", publications == 0 ? "NOT OBSERVED" : "OBSERVED", "journal", ".local/" + runId + ".jsonl"));
                System.out.println("Sandbox portfolio and mappings retained: " + account);
            } finally { api.sdkFeedsConfigureSubscription(restore); }
        }
    }
    private void readPublication(SdkApi api, JsonNode publication) throws Exception {
        String subjectId = publication.path("subjectId").asText();
        String language = publication.path("language").asText();
        switch (publication.path("surface").asText()) {
            case "MARKET" -> show("Market publication", api.sdkClarityMarketUpdate(new SdkClarityMarketUpdateRequest().language(language)));
            case "ASSET" -> show("Asset publication", api.sdkClarityAssetById(subjectId, language));
            case "PORTFOLIO" -> show("Portfolio publication", api.sdkClarityPortfolioById(subjectId, language, "1D"));
            default -> throw new IllegalArgumentException("Unknown publication surface");
        }
    }
    private void waitForCalculation(SdkApi api, String externalId, int revision) throws Exception {
        long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
        while (System.nanoTime() < deadline) {
            var portfolio = api.sdkPortfoliosGet(externalId);
            if (portfolio.getCalculatedRevision() != null && portfolio.getCalculatedRevision().intValue() == revision && "CURRENT".equals(String.valueOf(portfolio.getCalculation()))) {
                show("Calculated portfolio", portfolio);
                if (!Boolean.TRUE.equals(portfolio.getIsComplete())) throw new IllegalStateException("Portfolio has missing prices");
                return;
            }
            Thread.sleep(2000);
        }
        throw new IllegalStateException("Portfolio calculation timed out");
    }
    private void show(String label, Object value) throws Exception { System.out.println(label + ": " + mapper.writerWithDefaultPrettyPrinter().writeValueAsString(value)); }
    private static String value(String name, String fallback) { return ConfigProvider.getConfig().getOptionalValue(name, String.class).orElse(fallback); }
    private static String required(String name) { String value = value(name, ""); if (value.isBlank()) throw new IllegalArgumentException("Set " + name); return value; }
}
