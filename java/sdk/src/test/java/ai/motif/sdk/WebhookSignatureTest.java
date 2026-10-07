package ai.motif.sdk;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WebhookSignatureTest {
    @Test
    void verifiesRawBodyAndRejectsTamperingStaleAndFutureEvents() throws Exception {
        byte[] body = "{\"event\":\"webhook.test\"}".getBytes(StandardCharsets.UTF_8);
        String signature = sign(body, "1700000000", "whsec_test");
        Instant now = Instant.ofEpochSecond(1700000010);
        assertTrue(WebhookSignature.verify(body, signature, "1700000000", "whsec_test", now, 300));
        assertFalse(WebhookSignature.verify("{}".getBytes(StandardCharsets.UTF_8), signature, "1700000000", "whsec_test", now, 300));
        assertFalse(WebhookSignature.verify(body, signature, "1700000000", "wrong", now, 300));
        assertFalse(WebhookSignature.verify(body, signature, "1700000000", "whsec_test", now.plusSeconds(300), 300));
        assertFalse(WebhookSignature.verify(body, signature, "1700000000", "whsec_test", now.minusSeconds(20), 300));
        assertFalse(WebhookSignature.verify(body, null, "1700000000", "whsec_test"));
    }

    private static String sign(byte[] body, String timestamp, String secret) throws Exception {
        var digest = Mac.getInstance("HmacSHA256");
        digest.init(new SecretKeySpec("webhook-secret-salt".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String key = HexFormat.of().formatHex(digest.doFinal(secret.getBytes(StandardCharsets.UTF_8)));
        digest.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        digest.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
        return "v1=" + HexFormat.of().formatHex(digest.doFinal(body));
    }
}
