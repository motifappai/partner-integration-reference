package ai.motif.reference;

import java.net.URI;
import java.nio.file.Path;
import java.util.Locale;
import java.util.UUID;
import org.eclipse.microprofile.config.ConfigProvider;

public record Configuration(URI baseUrl, String apiKey, String organizationId, URI webhookUrl,
                            String mapping, boolean assets, Path document, boolean archive,
                            int listenSeconds, String runId, String accountExternalId) {
    public static Configuration parse(String[] arguments) {
        boolean apply = false;
        boolean assets = false;
        boolean archive = false;
        boolean help = false;
        String mapping = "local";
        Path document = null;
        int listenSeconds = 60;
        for (String argument : arguments) {
            if (argument.equals("--apply")) apply = true;
            else if (argument.equals("--assets")) assets = true;
            else if (argument.equals("--archive")) archive = true;
            else if (argument.equals("--help")) help = true;
            else if (argument.startsWith("--mapping=")) mapping = argument.substring(10);
            else if (argument.startsWith("--document=")) document = Path.of(argument.substring(11));
            else if (argument.startsWith("--listen-seconds=")) listenSeconds = Integer.parseInt(argument.substring(17));
            else throw new IllegalArgumentException("Unknown option: " + argument);
        }
        if (!apply || help) return null;
        if (!mapping.equals("local") && !mapping.equals("motif")) throw new IllegalArgumentException("Use --mapping=local or --mapping=motif");
        if (listenSeconds < 0 || listenSeconds > 600) throw new IllegalArgumentException("listen-seconds must be 0–600");
        URI baseUrl = sandboxUrl(value("MOTIF_API_BASE_URL", "https://staging.backend.motifapp.ai/api"));
        URI webhookUrl = URI.create(required("MOTIF_WEBHOOK_URL"));
        if (!"https".equals(webhookUrl.getScheme()) || webhookUrl.getHost() == null || webhookUrl.getPort() != -1
                || webhookUrl.getUserInfo() != null || webhookUrl.getQuery() != null || webhookUrl.getFragment() != null
                || !"/webhooks/motif".equals(webhookUrl.getPath())) throw new IllegalArgumentException("Use a public HTTPS webhook URL on port 443 ending in /webhooks/motif");
        String runId = "reference-" + UUID.randomUUID();
        return new Configuration(baseUrl, required("MOTIF_API_KEY"), required("MOTIF_ORG_ID"), webhookUrl,
                mapping, assets || document != null, document, archive, listenSeconds, runId, runId + "-account-42-a");
    }

    public static URI sandboxUrl(String value) {
        URI uri = URI.create(value);
        String host = uri.getHost();
        if (host == null) throw new IllegalArgumentException("Invalid API host");
        host = host.replaceAll("\\.+$", "").toLowerCase(Locale.ROOT);
        if (host.equals("backend.motifapp.ai")) throw new IllegalArgumentException("Use the sandbox for reference data");
        boolean local = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
        if ((!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && local))
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().equals("/api") || uri.getPath().equals("/api/"))) throw new IllegalArgumentException("Use an HTTPS API base URL ending in /api, or HTTP on localhost");
        return URI.create(value.replaceAll("/$", ""));
    }

    private static String value(String name, String fallback) {
        return ConfigProvider.getConfig().getOptionalValue(name, String.class).orElse(fallback);
    }

    private static String required(String name) {
        String value = value(name, "");
        if (value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
