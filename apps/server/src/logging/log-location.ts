import path from "path";
import type { Config } from "../config/config";
import type { RunState } from "../runtime/run-state";

/**
 * Where the log is, for the three questions that ask it.
 *
 * A detached server has nowhere to write but a file, so one has to be chosen
 * when configuration named none. It follows the data directory for the same
 * reason media does (§10): `--data /srv/silo` should keep one instance in one
 * place rather than scattering its database, its uploads and its log across
 * three defaults. The derived path is never written into `[log] file` — it is
 * passed to the detached child explicitly, so a value the user chose stays
 * distinguishable from one silo picked.
 */
export class LogLocation {
  static readonly Name = "silo.log";

  /** The file a detached run will write to: the configured one, else derived. */
  static forDetached(config: Config): string {
    return config.log.file ?? path.join(config.storage.path, LogLocation.Name);
  }

  /**
   * The file to read back. A running server's own record wins over
   * configuration, because it knows what it was actually started with.
   */
  static forReading(config: Config, state: RunState | null): string | undefined {
    return state?.log ?? config.log.file ?? undefined;
  }
}
