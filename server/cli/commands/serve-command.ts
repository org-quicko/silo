import { Service } from "../../core/service/service";
import { SiloServer } from "../../http/server";

export class ServeCommand {
  static async run(svc: Service, cfg: any, version: string, store: any): Promise<void> {
    await svc.initDefaults(cfg.default_project, cfg.default_env);
    const bootstrapKey = await svc.bootstrap();
    if (bootstrapKey) {
      const line = "=".repeat(64);
      console.error(
        `\n${line}\n First run — root API key (shown only this once):\n\n   ${bootstrapKey}\n\n Store it safely. Create more keys with: silo keys create\n${line}\n\n`
      );
    }

    if (cfg.auth.disabled) {
      console.log(
        "WARNING: auth is DISABLED — every request receives the root claim. Local development only."
      );
    }

    const meta = await svc.meta();
    const app = new SiloServer(svc, version, cfg.auth.disabled).build();

    // Parse listen address
    let hostname: string | undefined = undefined;
    let port = 8090;

    const listen = cfg.listen;
    if (listen.startsWith(":")) {
      port = parseInt(listen.slice(1), 10);
    } else {
      const parts = listen.split(":");
      if (parts.length === 2) {
        hostname = parts[0] || undefined;
        port = parseInt(parts[1], 10);
      } else {
        port = parseInt(listen, 10);
      }
    }

    if (isNaN(port)) {
      port = 8090;
    }

    const server = Bun.serve({
      port,
      hostname,
      fetch: app.fetch,
    });

    console.log(
      `silo ${version} listening on ${cfg.listen} (instance ${meta.instance_id}, driver ${cfg.storage.driver}, data ${cfg.storage.path})`
    );

    // Handle clean termination
    const shutdown = async () => {
      console.log("\nshutting down…");
      server.stop();
      await store.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Prevent process exiting
    await new Promise(() => {});
  }
}
