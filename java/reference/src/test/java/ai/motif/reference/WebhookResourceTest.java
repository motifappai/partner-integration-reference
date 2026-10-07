package ai.motif.reference;

import ai.motif.sdk.client.ApiClient;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WebhookResourceTest {
    @Test
    void rejectsWrongOrganizationEndpointAndSignature() throws Exception {
        var receiver = receiver(new AtomicInteger());
        try {
            String timestamp = Long.toString(Instant.now().getEpochSecond());
            byte[] body = event("other-org");
            assertEquals(400, receiver.receive(body, signature(body, timestamp), timestamp, "endpoint", "assessment.published", "event-1").getStatus());
            body = event("org");
            assertEquals(401, receiver.receive(body, signature(body, timestamp), timestamp, "another-endpoint", "assessment.published", "event-1").getStatus());
            assertEquals(401, receiver.receive(body, "invalid", timestamp, "endpoint", "assessment.published", "event-1").getStatus());
            assertEquals(400, receiver.receive(body, signature(body, timestamp), timestamp, "endpoint", "assessment.published", "wrong-event").getStatus());
            assertTrue(receiver.receipts().isEmpty());
        } finally { receiver.close(); }
    }

    @Test
    void deduplicatesSuccessfulReadsAndRetriesFailedReadsOnReplay() throws Exception {
        var calls = new AtomicInteger();
        var receiver = receiver(calls);
        receiver.initialize("org", event -> {
            if (calls.incrementAndGet() == 1) throw new IllegalStateException("Read unavailable");
        });
        try {
            byte[] body = event("org");
            String timestamp = Long.toString(Instant.now().getEpochSecond());
            String signature = signature(body, timestamp);
            assertEquals(204, receiver.receive(body, signature, timestamp, "endpoint", "assessment.published", "event-1").getStatus());
            receiver.drain();
            assertEquals("FAILED", receiver.receipts().getFirst().status());
            assertEquals(204, receiver.receive(body, signature, timestamp, "endpoint", "assessment.published", "event-1").getStatus());
            receiver.drain();
            assertEquals("READ", receiver.receipts().getFirst().status());
            assertEquals(204, receiver.receive(body, signature, timestamp, "endpoint", "assessment.published", "event-1").getStatus());
            receiver.drain();
            assertEquals(2, calls.get());
            assertEquals(3, receiver.deliveryCount("event-1"));
        } finally { receiver.close(); }
    }

    private static WebhookResource receiver(AtomicInteger calls) {
        var receiver = new WebhookResource();
        receiver.mapper = ApiClient.createDefaultObjectMapper();
        receiver.initialize("org", event -> calls.incrementAndGet());
        receiver.configure("endpoint", "whsec_test");
        return receiver;
    }

    private static byte[] event(String organization) {
        return ("""
                {"id":"event-1","event":"assessment.published","version":1,
                 "timestamp":"2026-10-07T00:00:00Z","organizationId":"%s",
                 "data":{"surface":"MARKET","subjectId":"GLOBAL","portfolioId":null,"revision":1,"language":"en"}}
                """).formatted(organization).getBytes(StandardCharsets.UTF_8);
    }

    private static String signature(byte[] body, String timestamp) throws Exception {
        var signer = Mac.getInstance("HmacSHA256");
        signer.init(new SecretKeySpec("webhook-secret-salt".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String derived = HexFormat.of().formatHex(signer.doFinal("whsec_test".getBytes(StandardCharsets.UTF_8)));
        signer.init(new SecretKeySpec(derived.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        signer.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
        return "v1=" + HexFormat.of().formatHex(signer.doFinal(body));
    }
}
