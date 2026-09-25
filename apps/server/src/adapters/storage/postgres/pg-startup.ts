import type { PgConnection } from "./pg-connection";
import { PgMigrations } from "./pg-migrations";
import { PgUnavailableError } from "./pg-unavailable-error";

/**
 * Reaching the server at boot, and waiting for it.
 *
 * In a container, Postgres often starts after silo does, so a start that
 * failed on the first refused connection would need an orchestrator's restart
 * loop to come up at all. The wait covers exactly "not there yet": a refused
 * or broken connection, a server still starting, one with no connection to
 * spare. A wrong password or a missing database is refused at once, because
 * no amount of waiting changes it.
 */
export class PgStartup {
  private static readonly MaxDelayMs = 5_000;

  /** Checks the server, retrying with backoff for up to `waitSeconds`. */
  static async reach(connection: PgConnection, url: string, waitSeconds: number): Promise<void> {
    const deadline = Date.now() + waitSeconds * 1000;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await PgMigrations.assertServerVersion(connection);
        return;
      } catch (error) {
        if (!(error instanceof PgUnavailableError) || error.failure === "unknown") throw error;
        const delay = Math.min(250 * 2 ** attempt, PgStartup.MaxDelayMs);
        if (Date.now() + delay > deadline) throw PgStartup.unreachable(url, waitSeconds, error);
        await Bun.sleep(delay);
      }
    }
  }

  /** Names the host, never the whole URL: it may carry the password. */
  private static unreachable(url: string, waitSeconds: number, cause: Error): Error {
    let host = "the configured server";
    try {
      host = new URL(url).host || host;
    } catch {
      // A URL that does not parse is reported without a host.
    }
    const waited = waitSeconds > 0 ? ` within ${waitSeconds}s` : "";
    return new Error(
      `could not reach Postgres at ${host}${waited} (${cause.message}); check [storage] url, and that the server is running and accepts connections`
    );
  }
}
