package ai.motif.sdk;

import ai.motif.sdk.api.SdkApi;
import ai.motif.sdk.client.ApiClient;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

public final class MotifClient {
    private final SdkApi api;

    public MotifClient(String apiKey, URI baseUrl) {
        this(apiKey, baseUrl, null);
    }

    public MotifClient(String apiKey, URI baseUrl, String userId) {
        if (apiKey == null || apiKey.isBlank()) throw new IllegalArgumentException("API key is required");
        if (baseUrl == null || baseUrl.getHost() == null || baseUrl.getUserInfo() != null
                || baseUrl.getQuery() != null || baseUrl.getFragment() != null) throw new IllegalArgumentException("Use a plain API base URL");
        boolean local = baseUrl.getHost().equals("localhost") || baseUrl.getHost().equals("127.0.0.1") || baseUrl.getHost().equals("[::1]");
        if (!"https".equals(baseUrl.getScheme()) && !("http".equals(baseUrl.getScheme()) && local)) throw new IllegalArgumentException("Use HTTPS, or HTTP on localhost");
        ApiClient client = new ApiClient(HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER),
                ApiClient.createDefaultObjectMapper(), baseUrl.toString());
        client.setConnectTimeout(Duration.ofSeconds(10));
        client.setReadTimeout(Duration.ofSeconds(30));
        client.setRequestInterceptor(request -> {
            request.setHeader("x-api-key", apiKey);
            if (userId != null && !userId.isBlank()) request.setHeader("x-user-id", userId);
        });
        api = new SdkApi(client);
    }

    public SdkApi api() {
        return api;
    }
}
