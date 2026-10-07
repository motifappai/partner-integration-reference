package ai.motif.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

public record AssessmentEvent(String id, String organizationId, Surface surface, String subjectId,
                              String portfolioId, int revision, String language) {
    public enum Surface { MARKET, ASSET, PORTFOLIO }

    public static AssessmentEvent parse(JsonNode payload) {
        if (!"assessment.published".equals(required(payload, "event"))
                || !payload.path("version").isIntegralNumber() || !payload.path("version").canConvertToInt() || payload.path("version").intValue() != 1)
            throw new IllegalArgumentException("Invalid publication event");
        Instant.parse(required(payload, "timestamp"));
        JsonNode data = payload.path("data");
        Surface surface = Surface.valueOf(required(data, "surface"));
        String subjectId = required(data, "subjectId");
        JsonNode portfolio = data.path("portfolioId");
        if (!(portfolio.isTextual() || portfolio.isNull())) throw new IllegalArgumentException("Invalid portfolio ID");
        String portfolioId = portfolio.isNull() ? null : portfolio.textValue();
        if ((surface == Surface.MARKET && !subjectId.equals("GLOBAL"))
                || (surface == Surface.PORTFOLIO ? !subjectId.equals(portfolioId) : portfolioId != null))
            throw new IllegalArgumentException("Inconsistent publication subject");
        if (!data.path("revision").canConvertToInt() || !data.path("revision").isIntegralNumber() || data.path("revision").intValue() < 1)
            throw new IllegalArgumentException("Invalid revision");
        return new AssessmentEvent(required(payload, "id"), required(payload, "organizationId"), surface,
                subjectId, portfolioId, data.path("revision").intValue(), required(data, "language"));
    }

    private static String required(JsonNode parent, String name) {
        JsonNode value = parent.path(name);
        if (!value.isTextual() || value.textValue().isBlank()) throw new IllegalArgumentException("Missing " + name);
        return value.textValue();
    }
}
