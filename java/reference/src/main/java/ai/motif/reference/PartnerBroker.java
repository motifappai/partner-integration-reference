package ai.motif.reference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.rabbitmq.client.AMQP;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

final class PartnerBroker implements AutoCloseable {
    interface PublicationReader { void read(JsonNode publication) throws Exception; }
    private final Connection connection;
    private final Channel channel;
    private final FileChannel journal;
    private final ObjectMapper mapper;
    private final String source;
    private final PublicationReader reader;
    private final Map<String, JsonNode> receipts = new HashMap<>();
    private final AtomicBoolean returned = new AtomicBoolean();
    private int publications;

    PartnerBroker(Path urlFile, boolean insecureLocal, String runId, ObjectMapper mapper, PublicationReader reader) throws Exception {
        this.mapper = mapper;
        this.reader = reader;
        source = "urn:partner:" + runId;
        URI uri = URI.create(Files.readString(urlFile).trim());
        boolean local = "127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost());
        if (!"amqps".equals(uri.getScheme()) && !(insecureLocal && local && "amqp".equals(uri.getScheme()))) throw new IllegalArgumentException("Partner broker requires TLS");
        ConnectionFactory factory = new ConnectionFactory();
        factory.setUri(uri);
        if ("amqps".equals(uri.getScheme())) {
            factory.useSslProtocol(javax.net.ssl.SSLContext.getDefault());
            factory.enableHostnameVerification();
        }
        factory.setAutomaticRecoveryEnabled(false);
        factory.setConnectionTimeout(10_000);
        factory.setRequestedHeartbeat(30);
        connection = factory.newConnection("motif-java-reference");
        channel = connection.createChannel();
        channel.confirmSelect();
        channel.addReturnListener(message -> returned.set(true));
        Path directory = Path.of(".local");
        Files.createDirectories(directory);
        Path journalPath = directory.resolve(runId + ".jsonl");
        journal = FileChannel.open(journalPath, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
        Files.setPosixFilePermissions(journalPath, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
    }

    JsonNode publish(String id, String type, String subject, Map<String, Object> data) throws Exception {
        var event = Map.of("specversion", "1.0", "id", id, "source", source, "type", type, "subject", subject,
                "time", data.get("asOf"), "datacontenttype", "application/json", "data", data);
        returned.set(false);
        channel.basicPublish("partner.input", "events", true, new AMQP.BasicProperties.Builder()
                .deliveryMode(2).contentType("application/cloudevents+json").messageId(id).build(), mapper.writeValueAsBytes(event));
        channel.waitForConfirmsOrDie(15_000);
        if (returned.get()) throw new IllegalStateException("Source publication was not routed");
        long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
        while (System.nanoTime() < deadline) {
            JsonNode receipt = receipts.get(id);
            if (receipt != null) {
                if (!"APPLIED".equals(receipt.path("status").asText())) throw new IllegalStateException("Feed rejected: " + receipt.path("code").asText());
                return receipt;
            }
            receive();
        }
        throw new IllegalStateException("No processing receipt; reconcile event through the receipt API: " + id);
    }

    private void receive() throws Exception {
        var message = channel.basicGet("partner.output", false);
        if (message == null) { Thread.sleep(100); return; }
        JsonNode event = mapper.readTree(message.getBody());
        if (!"1.0".equals(event.path("specversion").asText()) || !event.path("data").isObject()) throw new IllegalStateException("Invalid event envelope");
        ByteBuffer bytes = ByteBuffer.wrap((mapper.writeValueAsString(event) + "\n").getBytes(StandardCharsets.UTF_8));
        while (bytes.hasRemaining()) journal.write(bytes);
        journal.force(true);
        String type = event.path("type").asText();
        if ("ai.motif.feed.receipt.v1".equals(type)) {
            JsonNode receipt = event.path("data");
            if (source.equals(receipt.path("source").asText())) receipts.put(receipt.path("eventId").asText(), receipt);
        } else if ("ai.motif.assessment.published.v1".equals(type)) {
            reader.read(event.path("data"));
            publications++;
        } else throw new IllegalStateException("Unexpected event type");
        channel.basicAck(message.getEnvelope().getDeliveryTag(), false);
    }

    int listen(int seconds) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(seconds).toNanos();
        while (System.nanoTime() < deadline) receive();
        return publications;
    }
    @Override public void close() throws Exception {
        try { connection.close(); } finally { journal.close(); }
    }
}
