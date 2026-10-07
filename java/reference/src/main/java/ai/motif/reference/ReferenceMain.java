package ai.motif.reference;

import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.QuarkusApplication;
import io.quarkus.runtime.annotations.QuarkusMain;
import jakarta.inject.Inject;

@QuarkusMain
public class ReferenceMain implements QuarkusApplication {
    @Inject ConnectorLifecycle lifecycle;

    public static void main(String[] arguments) {
        Quarkus.run(ReferenceMain.class, arguments);
    }

    @Override
    public int run(String... arguments) throws Exception {
        lifecycle.run(arguments);
        return 0;
    }
}
