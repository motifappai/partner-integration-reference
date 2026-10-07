package ai.motif.reference;

import ai.motif.sdk.AssessmentEvent;
import ai.motif.sdk.MotifClient;
import ai.motif.sdk.api.SdkApi;
import ai.motif.sdk.client.ApiClient;
import ai.motif.sdk.model.SdkAssetsCreateDocumentRequest;
import ai.motif.sdk.model.SdkAssetsCreateRequest;
import ai.motif.sdk.model.SdkAssetsPutPriceRequest;
import ai.motif.sdk.model.SdkAssetsUpdateRequest;
import ai.motif.sdk.model.SdkClarityMarketUpdateRequest;
import ai.motif.sdk.model.SdkPortfoliosPutRequest;
import ai.motif.sdk.model.SdkPortfoliosPutRequestHoldingsInner;
import ai.motif.sdk.model.SdkPortfoliosPutRequestHoldingsInnerInstrument;
import ai.motif.sdk.model.SdkPortfoliosPutRequestHoldingsInnerInstrumentAnyOf;
import ai.motif.sdk.model.SdkWebhooksCreateRequest;
import ai.motif.sdk.model.SdkWebhooksUpdateRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

@ApplicationScoped
public class Lifecycle {
    @Inject WebhookResource receiver;
    private final ObjectMapper mapper = ApiClient.createDefaultObjectMapper();

    public void run(Configuration config) throws Exception {
        SdkApi api = new MotifClient(config.apiKey(), config.baseUrl()).api();
        byte[] document = config.document() == null ? null : Files.readAllBytes(config.document());
        if (document != null && (!config.document().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")
                || document.length == 0 || document.length > 20 * 1024 * 1024))
            throw new IllegalArgumentException("Use a nonempty sandbox PDF of at most 20 MiB");
        receiver.initialize(config.organizationId(), event -> readPublication(api, event));
        String subscriptionId = null;
        String portfolioId = null;
        try {
            System.out.println("\n1. Subscribe and receive a webhook");
            var subscription = api.sdkWebhooksCreate(new SdkWebhooksCreateRequest().name(config.runId())
                    .url(config.webhookUrl()).events(List.of("assessment.published")));
            subscriptionId = subscription.getId();
            receiver.configure(subscriptionId, subscription.getSecret());
            show("Subscription ID (secret held in memory)", subscriptionId);
            testSubscription(api, subscriptionId);

            System.out.println("\n2. Discover and map assets");
            String cursor = null;
            String assetId = null;
            do {
                var catalog = api.sdkAssetsList(cursor, 50, null, null);
                for (var asset : catalog.getAssets()) {
                    if ("AAPL".equals(asset.getSymbol()) && "NASDAQ".equals(asset.getExchange())
                            && "EQUITY".equals(String.valueOf(asset.getCategory()))) {
                        if (assetId != null && !assetId.equals(asset.getId()))
                            throw new IllegalStateException("More than one NASDAQ AAPL listing; resolve the instrument mapping before continuing");
                        if (config.mapping().equals("motif") && asset.getExternalId() != null)
                            throw new IllegalStateException("This listing already has an external reference; preserve it and use --mapping=local");
                        assetId = asset.getId();
                        show("Selected Apple listing; verify name and exchange", asset);
                    }
                }
                cursor = catalog.getNextCursor();
            } while (cursor != null);
            if (assetId == null) throw new IllegalStateException("No NASDAQ AAPL equity in the catalog; resolve the listing with Motif");
            String externalAssetId = config.runId() + "-security-apple";
            if (config.mapping().equals("motif")) {
                api.sdkAssetsUpdate(assetId, new SdkAssetsUpdateRequest().externalId(externalAssetId).currency("USD"));
                var matches = api.sdkAssetsList(null, 1, null, externalAssetId).getAssets();
                if (matches.isEmpty() || !assetId.equals(matches.getFirst().getId())
                        || !externalAssetId.equals(matches.getFirst().getExternalId()))
                    throw new IllegalStateException("Asset mapping was not persisted");
                show("Organization asset reference stored in Motif", matches.getFirst());
            } else show("Save this mapping in your own instrument database", java.util.Map.of("externalId", externalAssetId, "assetId", assetId));
            String customAssetId = null;
            if (config.assets()) {
                String customExternalId = config.runId() + "-private-fund-a";
                var matches = api.sdkAssetsList(null, 1, null, customExternalId).getAssets();
                if (!matches.isEmpty() && (!customExternalId.equals(matches.getFirst().getExternalId())
                        || !"CUSTOM".equals(String.valueOf(matches.getFirst().getCategory()))))
                    throw new IllegalStateException("Exact custom reference lookup failed; verify the API release and instrument mapping");
                customAssetId = matches.isEmpty() ? api.sdkAssetsCreate(new SdkAssetsCreateRequest()
                        .externalId(customExternalId).name("Private Fund A").symbol("PFA").currency("USD")
                        .description("Partner supplied private fund units")).getId() : matches.getFirst().getId();
                show("Custom asset", api.sdkAssetsGet(customAssetId));
                api.sdkAssetsUpdate(customAssetId, new SdkAssetsUpdateRequest().currency("USD")
                        .priceProvider(SdkAssetsUpdateRequest.PriceProviderEnum.CUSTOM));
                OffsetDateTime asOf = OffsetDateTime.now(java.time.ZoneOffset.UTC);
                var price = new SdkAssetsPutPriceRequest().asOf(asOf).revision(1).unitPrice("12.50").currency("USD");
                api.sdkAssetsPutPrice(customAssetId, price);
                api.sdkAssetsPutPrice(customAssetId, price);
                api.sdkAssetsPutPrice(customAssetId, new SdkAssetsPutPriceRequest().asOf(asOf).revision(2).unitPrice("13").currency("USD"));
                show("Price history after an identical retry and dated correction", api.sdkAssetsPrices(customAssetId, null, 50));
                if (document != null) uploadDocument(api, customAssetId, config, document);
                else System.out.println("NOT EXERCISED: optional document upload (use --document).");
            } else System.out.println("NOT EXERCISED: optional assets, prices and documents (use --assets / --document).");

            System.out.println("\n3. Read market updates and asset insights");
            show("Market update; null means not yet available", api.sdkClarityMarketUpdate(new SdkClarityMarketUpdateRequest().language("en")));
            show("Asset insight; null means not yet available", api.sdkClarityAssetById(assetId, "en"));

            System.out.println("\n4. Create a portfolio");
            var initial = snapshot(1, assetId, customAssetId);
            show("Initial complete snapshot", initial);
            var receipt = api.sdkPortfoliosPut(config.accountExternalId(), initial);
            portfolioId = receipt.getPortfolioId();
            show("Store externalId → portfolioId: " + config.accountExternalId(), receipt);
            waitForCalculation(api, config.accountExternalId(), 1);

            System.out.println("\n5. Update a portfolio");
            var updated = snapshot(2, assetId, customAssetId);
            show("Replacement complete snapshot", updated);
            api.sdkPortfoliosPut(config.accountExternalId(), updated);
            api.sdkPortfoliosPut(config.accountExternalId(), updated);
            waitForCalculation(api, config.accountExternalId(), 2);

            System.out.println("\n6. Read portfolio insights");
            show("Portfolio insight; card/read may be null", api.sdkClarityPortfolioById(portfolioId, "en", "1D"));
            System.out.println("\n7. Keep the integration running");
            System.out.println("Waiting " + config.listenSeconds() + "s for real publications; a signed test does not generate research.");
            Thread.sleep(Duration.ofSeconds(config.listenSeconds()));
            receiver.drain();
            var history = api.sdkWebhooksDeliveries(subscriptionId, 50, null);
            show("Webhook delivery history", history);
            var assessment = history.getDeliveries().stream().filter(delivery -> "assessment.published".equals(delivery.getEvent())).findFirst();
            if (assessment.isPresent()) {
                var previousCounts = new HashMap<String, Long>();
                for (var received : receiver.receipts()) previousCounts.put(received.event().id(), receiver.deliveryCount(received.event().id()));
                var replay = api.sdkWebhooksReplay(subscriptionId, assessment.get().getId());
                show("Replay queued", replay);
                long previous = previousCounts.getOrDefault(replay.getEventId(), 0L);
                long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
                while (receiver.deliveryCount(replay.getEventId()) <= previous && System.nanoTime() < deadline) Thread.sleep(2000);
                System.out.println(receiver.deliveryCount(replay.getEventId()) > previous
                        ? "Replay received; duplicate event is not processed twice" : "NOT OBSERVED: replay delivery within two minutes");
            } else System.out.println("NOT EXERCISED: replay requires a real delivered assessment");
            api.sdkWebhooksUpdate(subscriptionId, new SdkWebhooksUpdateRequest().enabled(false));
            var rotated = api.sdkWebhooksRotateSecret(subscriptionId);
            receiver.configure(subscriptionId, rotated.getSecret());
            api.sdkWebhooksUpdate(subscriptionId, new SdkWebhooksUpdateRequest().enabled(true));
            testSubscription(api, subscriptionId);
            receiver.drain();
            show("Publication processing results", receiver.receipts());
            for (var surface : AssessmentEvent.Surface.values()) {
                if (receiver.receipts().stream().noneMatch(received -> received.event().surface() == surface))
                    System.out.println("NOT OBSERVED: real " + surface + " publication");
            }
            if (receiver.receipts().stream().anyMatch(received -> received.status().equals("FAILED")))
                throw new IllegalStateException("A publication could not be read; inspect processing results");
            System.out.println("Walkthrough complete. Null content and NOT OBSERVED / NOT EXERCISED results remain unverified.");
        } finally {
            try {
                if (subscriptionId != null) {
                    api.sdkWebhooksDelete(subscriptionId);
                    System.out.println("Deleted this run’s subscription " + subscriptionId);
                }
            } finally {
                receiver.close();
                if (portfolioId != null && config.archive()) {
                    api.sdkPortfoliosArchive(portfolioId);
                    System.out.println("Archived this run’s portfolio " + portfolioId);
                } else if (portfolioId != null) show("Retained sandbox portfolio", portfolioId);
                System.out.println("Custom assets and documents, if created, remain in the sandbox; there is no public deletion endpoint.");
            }
        }
    }

    static SdkPortfoliosPutRequest snapshot(int revision, String assetId, String customAssetId) {
        var holdings = new ArrayList<SdkPortfoliosPutRequestHoldingsInner>();
        holdings.add(holding(assetId, revision == 1 ? "10" : "12"));
        if (customAssetId != null) holdings.add(holding(customAssetId, "5"));
        return new SdkPortfoliosPutRequest().revision(revision).asOf(OffsetDateTime.now(java.time.ZoneOffset.UTC))
                .currency("USD").cash(revision == 1 ? "1000" : "600").holdings(holdings);
    }

    private static SdkPortfoliosPutRequestHoldingsInner holding(String assetId, String quantity) {
        var instrument = new SdkPortfoliosPutRequestHoldingsInnerInstrumentAnyOf()
                .type(SdkPortfoliosPutRequestHoldingsInnerInstrumentAnyOf.TypeEnum.ASSET).assetId(assetId);
        return new SdkPortfoliosPutRequestHoldingsInner().instrument(new SdkPortfoliosPutRequestHoldingsInnerInstrument(instrument))
                .quantity(quantity).currency("USD");
    }

    private void readPublication(SdkApi api, AssessmentEvent event) throws Exception {
        switch (event.surface()) {
            case MARKET -> show("Market publication", api.sdkClarityMarketUpdate(new SdkClarityMarketUpdateRequest().language(event.language())));
            case ASSET -> show("Asset publication", api.sdkClarityAssetById(event.subjectId(), event.language()));
            case PORTFOLIO -> show("Portfolio publication", api.sdkClarityPortfolioById(event.subjectId(), event.language(), "1D"));
        }
    }

    private void testSubscription(SdkApi api, String id) throws Exception {
        long before = receiver.testCount();
        var delivery = api.sdkWebhooksTest(id);
        if (!Boolean.TRUE.equals(delivery.getSuccess()) || delivery.getStatusCode() == null
                || delivery.getStatusCode().intValue() < 200 || delivery.getStatusCode().intValue() >= 300
                || receiver.testCount() <= before) throw new IllegalStateException("Signed test did not succeed at this receiver");
        show("Signed test received and verified", delivery);
    }

    private void waitForCalculation(SdkApi api, String externalId, int revision) throws Exception {
        long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
        while (System.nanoTime() < deadline) {
            var portfolio = api.sdkPortfoliosGet(externalId);
            if (portfolio.getCalculatedRevision() != null && portfolio.getCalculatedRevision().intValue() == revision
                    && "CURRENT".equals(String.valueOf(portfolio.getCalculation()))) {
                show("Calculated portfolio", portfolio);
                if (!Boolean.TRUE.equals(portfolio.getIsComplete()))
                    throw new IllegalStateException("Portfolio has missing prices; inspect holdings before displaying a complete total");
                return;
            }
            Thread.sleep(2000);
        }
        throw new IllegalStateException("Calculation not complete within two minutes for revision " + revision);
    }

    private void uploadDocument(SdkApi api, String assetId, Configuration config, byte[] bytes) throws Exception {
        var upload = api.sdkAssetsCreateDocument(assetId, new SdkAssetsCreateDocumentRequest()
                .fileName(config.document().getFileName().toString()).mimeType(SdkAssetsCreateDocumentRequest.MimeTypeEnum.APPLICATION_PDF)
                .sizeBytes(bytes.length));
        String documentId = upload.getDocumentId();
        show("Save document receipt", java.util.Map.of("assetId", assetId, "documentId", documentId));
        var request = HttpRequest.newBuilder(URI.create(upload.getUploadUrl())).timeout(Duration.ofSeconds(30))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes));
        upload.getHeaders().forEach(request::header);
        try (var storage = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(10)).build()) {
            var response = storage.send(request.build(), HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() < 200 || response.statusCode() >= 300)
                throw new IllegalStateException("Storage upload failed: HTTP " + response.statusCode());
        }
        api.sdkAssetsFinalizeDocument(assetId, documentId);
        long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
        while (System.nanoTime() < deadline) {
            var status = api.sdkAssetsDocument(assetId, documentId);
            if ("COMPLETED".equals(String.valueOf(status.getStatus()))) { show("Document completed", status); return; }
            if ("FAILED".equals(String.valueOf(status.getStatus()))) throw new IllegalStateException("Document failed: " + status.getError());
            Thread.sleep(2000);
        }
        throw new IllegalStateException("Document still processing after two minutes; use its printed ID to inspect status");
    }

    private void show(String label, Object value) throws Exception {
        System.out.println(label + ": " + mapper.writerWithDefaultPrettyPrinter().writeValueAsString(value));
    }
}
