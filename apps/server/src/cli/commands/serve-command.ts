import type { Config } from "../../config/config";
import { SiloServer } from "../../http/server";
import type { SiloRuntime } from "../runtime/silo-runtime";
import { ListenAddress } from "../../runtime/listen-address";
import { ProcessTitle } from "../../runtime/process-title";
import { RunFile } from "../../runtime/run-file";
import { BootstrapBanner } from "../bootstrap-banner";
import { Observability } from "../../observability";

/**
 * `silo serve` — the long-running server.
 *
 * Identical whether it was started in the foreground or by `--detach`: the
 * detached child runs this exact code path, having been handed a `--log-file`.
 * Nothing here knows or cares which it is, which is what keeps the two from
 * drifting.
 */
export class ServeCommand {
  /**
   * The whole runtime rather than four of its fields: since D35 this needs the
   * plugin registry as well, to hand it the app once it exists, and a sixth
   * positional argument would have been the point where the list stopped being
   * readable.
   */
  static async run(runtime: SiloRuntime, config: Config, version: string): Promise<void> {
    const { service, store, logger, plugins, supervisor, mediaStorage, mediaPolicy, settings } =
      runtime;
    // Before anything is written. Two servers over one data directory hand out
    // duplicate `seq` values and defeat the process-local write mutex that
    // makes optimistic concurrency sound — see RunFile.assertNotRunning.
    await RunFile.assertNotRunning(config.storage.path);

    await service.scopes.initDefaults(config.default_project, config.default_env);
    const bootstrapKey = await service.keys.bootstrap();
    if (bootstrapKey) {
      // Past the level threshold and past any formatting: this credential is
      // shown exactly once (§8), so it must not be filtered by `[log] level`
      // or wrapped into a JSON field. Colour only when a terminal is the sole
      // destination — escape codes in a log file are noise.
      logger.raw(BootstrapBanner.render(bootstrapKey, { isTTY: logger.isInteractive() }));
    }

    if (config.auth.disabled) {
      logger.warn("auth is DISABLED — every request receives the root claim. Local development only.");
    }

    // Finishes any media deletion the process died partway through: the
    // catalog and a remote object store cannot share a transaction, so the
    // saga's last two steps are retried here rather than left staged
    // indefinitely (D23).
    // Same reasoning one step over: a folder rename rewrites more records than
    // any adapter can write atomically, so it is staged and finished here (D49).
    const moves = await service.media.resumePendingFolderMoves();
    if (moves.finished > 0) {
      logger.info("finished pending media folder moves", { count: moves.finished });
    }
    if (moves.pending > 0) {
      logger.warn(
        "media folder moves could not be completed. The subtree is split across both paths; renaming again with merge finishes it.",
        { count: moves.pending }
      );
    }

    const resumed = await service.media.resumePendingDeletions();
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

    const meta = await service.meta();
    const app = new SiloServer(service, {
      version,
      authDisabled: config.auth.disabled,
      logger,
      logRequests: config.log.requests,
      // The management API acts on the live set, not on the record alone
      // (D39) — enabling a plugin starts it, and revoking a grant stops
      // delivery on the next hook rather than at the next start.
      plugins: supervisor,
      // Same shape, one subject narrower: where media bytes go, changed live
      // and written back to silo.toml (D45).
      mediaStorage,
      mediaPolicy,
      settings,
      observability: new Observability({
        dataDirectory: config.storage.path,
        mediaDirectory:
          config.blob_storage.driver === "fs" ? config.blob_storage.path : undefined,
        storageDriver: config.storage.driver,
        blobDriver: config.blob_storage.driver,
      }),
    }).build();

    // Before the bind, so no request can arrive while a plugin's `ctx.fetch`
    // would still refuse for want of an app (D35).
    plugins.attach(app);

    // And only then may they act. `activate(ctx)` is the first thing a plugin
    // does of its own accord, so it needs the surface above — and it runs before
    // the bind, so a plugin that seeds or migrates something has finished before
    // the first request can observe half of it (D36).
    await plugins.activate();

    const { hostname, port } = ListenAddress.parse(config.listen);
    const server = Bun.serve({ port, hostname, fetch: app.fetch });

    // Named after the bind, for the reason the run file is written after it:
    // a start that lost the port race must not announce that address anywhere.
    ProcessTitle.set(config.listen);

    // Written after the bind succeeds, so a start that lost a port race never
    // leaves a record claiming the address.
    await RunFile.write(config.storage.path, {
      pid: process.pid,
      version,
      listen: config.listen,
      data: config.storage.path,
      driver: config.storage.driver,
      log: logger.file,
      started_at: new Date().toISOString(),
    });

    logger.info("listening", {
      version,
      listen: config.listen,
      instance: meta.instance_id,
      driver: config.storage.driver,
      data: config.storage.path,
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
      await RunFile.remove(config.storage.path);
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
