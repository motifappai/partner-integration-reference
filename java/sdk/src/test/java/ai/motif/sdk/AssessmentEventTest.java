package ai.motif.sdk;

import ai.motif.sdk.client.ApiClient;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AssessmentEventTest {
    @Test
    void validatesSubjectIdentityAndIntegerVersion() throws Exception {
        var payload = ApiClient.createDefaultObjectMapper().readTree("""
                {"id":"event-1","event":"assessment.published","version":1,
                 "timestamp":"2026-10-07T00:00:00Z","organizationId":"org",
                 "data":{"surface":"MARKET","subjectId":"GLOBAL","portfolioId":null,"revision":1,"language":"en"}}
                """);
        assertEquals(AssessmentEvent.Surface.MARKET, AssessmentEvent.parse(payload).surface());
        var mapper = ApiClient.createDefaultObjectMapper();
        assertThrows(IllegalArgumentException.class, () -> AssessmentEvent.parse(mapper.readTree(payload.toString().replace("GLOBAL", "asset-id"))));
        assertThrows(IllegalArgumentException.class, () -> AssessmentEvent.parse(mapper.readTree(payload.toString().replace("\"version\":1", "\"version\":4294967297"))));
        assertThrows(IllegalArgumentException.class, () -> AssessmentEvent.parse(mapper.readTree(payload.toString().replace("\"revision\":1", "\"revision\":1.5"))));
    }
}
