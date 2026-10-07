package ai.motif.sdk;

import ai.motif.sdk.client.ApiClient;
import ai.motif.sdk.client.ApiException;
import ai.motif.sdk.model.SdkAssetsUpdateRequest;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.LinkedBlockingQueue;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MotifClientTest {
    @Test
    void preservesPatchOmissionAndExplicitNull() throws Exception {
        var mapper = ApiClient.createDefaultObjectMapper();
        var omitted = mapper.readTree(mapper.writeValueAsString(new SdkAssetsUpdateRequest().currency("USD")));
        var cleared = mapper.readTree(mapper.writeValueAsString(new SdkAssetsUpdateRequest().externalId(null)));
        assertFalse(omitted.has("externalId"));
        assertTrue(cleared.has("externalId"));
        assertTrue(cleared.get("externalId").isNull());
    }

    @Test
    void keepsCredentialsPerClientAndEncodesExactReferences() throws Exception {
        var requests = new LinkedBlockingQueue<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/sdk/assets", exchange -> {
            requests.add(exchange.getRequestHeaders().getFirst("x-api-key") + ":" + exchange.getRequestHeaders().getFirst("x-user-id") + ":" + exchange.getRequestURI().getRawQuery());
            byte[] body = "{\"assets\":[],\"nextCursor\":null}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api");
            var first = new MotifClient("first-key", base, "first-user").api();
            var second = new MotifClient("second-key", base).api();
            first.sdkAssetsList(null, 50, null, "ISIN/A+B & listing");
            second.sdkAssetsList(null, 1, null, "second");
            first.sdkAssetsList(null, 1, null, "again");
            String firstRequest = requests.remove();
            assertTrue(firstRequest.startsWith("first-key:first-user:"));
            assertTrue(firstRequest.contains("externalId=ISIN%2FA%2BB%20%26%20listing"), firstRequest);
            assertTrue(requests.remove().startsWith("second-key:null:"));
            assertTrue(requests.remove().startsWith("first-key:first-user:"));
        } finally { server.stop(0); }
    }

    @Test
    void exposesHttpStatusAndDoesNotFollowRedirects() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/sdk/assets", exchange -> {
            exchange.getResponseHeaders().set("Location", "https://example.com/private");
            exchange.sendResponseHeaders(307, -1);
            exchange.close();
        });
        server.start();
        try {
            var api = new MotifClient("key", URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api")).api();
            var failure = assertThrows(ApiException.class, () -> api.sdkAssetsList(null, 1, null, null));
            assertEquals(307, failure.getCode());
        } finally { server.stop(0); }
    }
}
