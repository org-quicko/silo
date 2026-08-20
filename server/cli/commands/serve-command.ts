import { Service } from "../../core/service/service";
import { SiloServer } from "../../http/server";
import { BootstrapBanner } from "../bootstrap-banner";

export class ServeCommand {
  static async run(svc: Service, cfg: any, version: string, store: any): Promise<void> {
    await svc.initDefaults(cfg.default_project, cfg.default_env);
    const bootstrapKey = await svc.bootstrap();
    if (bootstrapKey) {
      // Written straight to the stream rather than through `console.error`,
      // which tints its whole output red on a TTY — that wrapper would sit
      // underneath the banner's own colours and add a newline to a string that
      // already ends where it means to.
      process.stderr.write(BootstrapBanner.render(bootstrapKey));
    }

    if (cfg.auth.disabled) {
      console.log(
        "WARNING: auth is DISABLED — every request receives the root claim. Local development only."
      );
    }

    // Finishes any media deletion the process died partway through: the
    // catalog and a remote object store cannot share a transaction, so the
    // saga's last two steps are retried here rather than left staged
    // indefinitely (D23).
    const resumed = await svc.resumePendingMediaDeletions();
    if (resumed.finished > 0) {
      console.log(
        `finished ${resumed.finished} pending media deletion${resumed.finished === 1 ? "" : "s"}`
      );
    }
    if (resumed.pending > 0) {
      // Non-fatal by design, but not silent: an asset stuck in `deleting`
      // refuses new references until something clears it, and
      // `silo media reconcile` is what returns it to active.
      console.log(
        `WARNING: ${resumed.pending} media deletion${resumed.pending === 1 ? "" : "s"} could not be completed — the blob store rejected the delete. Run "silo media reconcile" to retry, or to return the asset to active if the delete keeps failing.`
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
