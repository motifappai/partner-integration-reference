package ai.motif.sdk;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class WebhookSignature {
    private WebhookSignature() {}

    public static boolean verify(byte[] body, String signature, String timestamp, String secret) {
        return verify(body, signature, timestamp, secret, Instant.now(), 300);
    }

    public static boolean verify(byte[] body, String signature, String timestamp, String secret,
                                 Instant now, long toleranceSeconds) {
        if (body == null || signature == null || timestamp == null || secret == null || secret.isBlank()
                || toleranceSeconds < 0 || !timestamp.matches("[0-9]+")
                || !signature.matches("v1=[0-9a-fA-F]{64}")) return false;
        try {
            long seconds = Long.parseLong(timestamp);
            if (seconds > now.getEpochSecond() || now.getEpochSecond() - seconds > toleranceSeconds) return false;
            String derivedKey = HexFormat.of().formatHex(hmac("webhook-secret-salt", secret.getBytes(StandardCharsets.UTF_8)));
            Mac signer = Mac.getInstance("HmacSHA256");
            signer.init(new SecretKeySpec(derivedKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            signer.update((timestamp + ".").getBytes(StandardCharsets.UTF_8));
            byte[] expected = signer.doFinal(body);
            return MessageDigest.isEqual(expected, HexFormat.of().parseHex(signature.substring(3)));
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            return false;
        }
    }

    private static byte[] hmac(String key, byte[] body) throws GeneralSecurityException {
        Mac signer = Mac.getInstance("HmacSHA256");
        signer.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return signer.doFinal(body);
    }
}
