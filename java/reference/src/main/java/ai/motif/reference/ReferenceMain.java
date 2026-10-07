package ai.motif.reference;

import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.QuarkusApplication;
import io.quarkus.runtime.annotations.QuarkusMain;
import jakarta.inject.Inject;

@QuarkusMain
public class ReferenceMain implements QuarkusApplication {
    @Inject Lifecycle lifecycle;

    public static void main(String[] arguments) {
        Quarkus.run(ReferenceMain.class, arguments);
    }

    @Override
    public int run(String... arguments) throws Exception {
        System.out.println("Guide: https://motif.gitbook.io/motif-docs/integrate-with-motif/partner-data-and-insights");
        Configuration configuration = Configuration.parse(arguments);
        if (configuration == null) {
            System.out.println("Preview only; no Motif requests. Use --apply to execute the guide. Options: --mapping=local|motif --assets --document=/path/factsheet.pdf --listen-seconds=60 --archive");
            System.out.println("1. Subscribe and receive a webhook\n2. Discover and map assets\n3. Read market updates and asset insights\n4. Create a portfolio\n5. Update a portfolio\n6. Read portfolio insights\n7. Keep the integration running");
            return 0;
        }
        lifecycle.run(configuration);
        return 0;
    }
}
