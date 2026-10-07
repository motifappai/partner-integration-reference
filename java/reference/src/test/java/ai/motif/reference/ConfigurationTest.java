package ai.motif.reference;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ConfigurationTest {
    @Test
    void rejectsProductionVariantsBeforeRequests() {
        for (String host : new String[]{"backend.motifapp.ai", "BACKEND.MOTIFAPP.AI", "backend.motifapp.ai.", "backend.motifapp.ai.."})
            assertThrows(IllegalArgumentException.class, () -> Configuration.sandboxUrl("https://" + host + "/api"));
        assertThrows(IllegalArgumentException.class, () -> Configuration.sandboxUrl("http://example.com/api"));
        assertThrows(IllegalArgumentException.class, () -> Configuration.sandboxUrl("https://key@example.com/api"));
        assertEquals("http://localhost:8788/api", Configuration.sandboxUrl("http://localhost:8788/api/").toString());
    }
}
