import type { Config } from "../../config/config";
import type { Storage } from "../../core/ports/storage";
import { Service } from "../../core/service/service";
import { SiloServer } from "../../http/server";
import type { Logger } from "../../logging/logger";
import { ListenAddress } from "../../runtime/listen-address";
import { ProcessTitle } from "../../runtime/process-title";
import { RunFile } from "../../runtime/run-file";
import { BootstrapBanner } from "../bootstrap-banner";

/**
 * `silo serve` — the long-running server.
 *
 * Identical whether it was started in the foreground or by `--detach`: the
 * detached child runs this exact code path, having been handed a `--log-file`.
 * Nothing here knows or cares which it is, which is what keeps the two from
 * drifting.
 */
export class ServeCommand {
  static async run(
    svc: Service,
    cfg: Config,
    version: string,
    store: Storage,
    logger: Logger
  ): Promise<void> {
    // Before anything is written. Two servers over one data directory hand out
    // duplicate `seq` values and defeat the process-local write mutex that
    // makes optimistic concurrency sound — see RunFile.assertNotRunning.
    await RunFile.assertNotRunning(cfg.storage.path);

    await svc.initDefaults(cfg.default_project, cfg.default_env);
    const bootstrapKey = await svc.bootstrap();
    if (bootstrapKey) {
      // Past the level threshold and past any formatting: this credential is
      // shown exactly once (§8), so it must not be filtered by `[log] level`
      // or wrapped into a JSON field. Colour only when a terminal is the sole
      // destination — escape codes in a log file are noise.
      logger.raw(BootstrapBanner.render(bootstrapKey, { isTTY: logger.isInteractive() }));
    }

    if (cfg.auth.disabled) {
      logger.warn("auth is DISABLED — every request receives the root claim. Local development only.");
    }

    // Finishes any media deletion the process died partway through: the
    // catalog and a remote object store cannot share a transaction, so the
    // saga's last two steps are retried here rather than left staged
    // indefinitely (D23).
    const resumed = await svc.resumePendingMediaDeletions();
    if (resumed.finished > 0) {
      logger.info("finished pending media deletions", { count: resumed.finished });
    }
    if (resumed.pending > 0) {
      // Non-fatal by design, but not silent: an asset stuck in `deleting`
      // refuses new references until something clears it, and
      // `silo media reconcile` is what returns it to active.
      logger.warn(
        'media deletions could not be completed — the blob store rejected the delete. Run "silo media reconcile" to retry, or to return the asset to active if the delete keeps failing.',
        { count: resumed.pending }
      );
    }

    const meta = await svc.meta();
    const app = new SiloServer(svc, {
      version,
      authDisabled: cfg.auth.disabled,
      logger,
      logRequests: cfg.log.requests,
    }).build();

    const { hostname, port } = ListenAddress.parse(cfg.listen);
    const server = Bun.serve({ port, hostname, fetch: app.fetch });

    // Named after the bind, for the reason the run file is written after it:
    // a start that lost the port race must not announce that address anywhere.
    ProcessTitle.set(cfg.listen);

    // Written after the bind succeeds, so a start that lost a port race never
    // leaves a record claiming the address.
    await RunFile.write(cfg.storage.path, {
      pid: process.pid,
      version,
      listen: cfg.listen,
      data: cfg.storage.path,
      driver: cfg.storage.driver,
      log: logger.file,
      started_at: new Date().toISOString(),
    });

    logger.info("listening", {
      version,
      listen: cfg.listen,
      instance: meta.instance_id,
      driver: cfg.storage.driver,
      data: cfg.storage.path,
      pid: process.pid,
    });

    let stopping = false;
    const shutdown = async () => {
      // A second SIGTERM while the first is draining must not run this twice
      // and race the store closed underneath itself.
      if (stopping) return;
      stopping = true;
      logger.info("shutting down");
      server.stop();
      await RunFile.remove(cfg.storage.path);
      await store.close();
      await logger.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Prevent process exiting
    await new Promise(() => {});
  }
}
