package ai.motif.reference;

import ai.motif.sdk.AssessmentEvent;
import ai.motif.sdk.WebhookSignature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@ApplicationScoped
@Path("/webhooks/motif")
public class WebhookResource {
    @FunctionalInterface
    public interface PublicationReader { void read(AssessmentEvent event) throws Exception; }
    public record Receipt(AssessmentEvent event, String status, String error) {}
    private record Subscription(String id, String secret) {}
    @Inject ObjectMapper mapper;
    private volatile Subscription subscription;
    private String organizationId;
    private PublicationReader reader;
    private final AtomicLong tests = new AtomicLong();
    private final ConcurrentHashMap<String, Receipt> receipts = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> counts = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(256), Thread.ofPlatform().daemon().name("publication-reader").factory());

    public void initialize(String organizationId, PublicationReader reader) {
        this.organizationId = organizationId;
        this.reader = reader;
    }

    public void configure(String id, String secret) { subscription = new Subscription(id, secret); }
    public long testCount() { return tests.get(); }
    public long deliveryCount(String eventId) { return counts.getOrDefault(eventId, 0L); }
    public List<Receipt> receipts() { return List.copyOf(receipts.values()); }

    @POST
    @Consumes("application/json")
    public synchronized Response receive(byte[] body, @HeaderParam("x-webhook-signature") String signature,
            @HeaderParam("x-webhook-timestamp") String timestamp, @HeaderParam("x-webhook-id") String endpointId,
            @HeaderParam("x-webhook-event") String eventName, @HeaderParam("x-webhook-event-id") String eventId) {
        Subscription current = subscription;
        if (current == null) return Response.status(503).build();
        if (body == null || body.length > 1_048_576) return Response.status(413).build();
        if (!current.id().equals(endpointId) || !WebhookSignature.verify(body, signature, timestamp, current.secret()))
            return Response.status(401).build();
        try {
            var payload = mapper.readTree(body);
            if ("webhook.test".equals(eventName) && "webhook.test".equals(payload.path("event").asText())
                    && current.id().equals(payload.path("data").path("webhookId").asText())) {
                tests.incrementAndGet();
                return Response.noContent().build();
            }
            AssessmentEvent event = AssessmentEvent.parse(payload);
            if (!"assessment.published".equals(eventName) || !event.id().equals(eventId)
                    || !event.organizationId().equals(organizationId)) return Response.status(400).build();
            Receipt previous = receipts.get(event.id());
            if (previous == null || previous.status().equals("FAILED")) {
                receipts.put(event.id(), new Receipt(event, "QUEUED", null));
                try {
                    worker.execute(() -> {
                        try {
                            reader.read(event);
                            receipts.put(event.id(), new Receipt(event, "READ", null));
                        } catch (Exception failure) {
                            receipts.put(event.id(), new Receipt(event, "FAILED", failure.getClass().getSimpleName()));
                        }
                    });
                } catch (RejectedExecutionException failure) {
                    if (previous == null) receipts.remove(event.id());
                    else receipts.put(event.id(), previous);
                    return Response.status(503).build();
                }
            }
            counts.merge(event.id(), 1L, Long::sum);
            return Response.noContent().build();
        } catch (Exception failure) {
            return Response.status(400).build();
        }
    }

    public void drain() throws Exception { worker.submit(() -> {}).get(120, TimeUnit.SECONDS); }

    @PreDestroy
    public void close() throws InterruptedException {
        subscription = null;
        worker.shutdown();
        if (!worker.awaitTermination(120, TimeUnit.SECONDS)) worker.shutdownNow();
    }
}
