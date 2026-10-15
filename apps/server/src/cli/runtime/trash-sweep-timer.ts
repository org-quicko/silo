import { TrashDefaults } from "../../config/trash-defaults";
import type { TrashService } from "../../core/services/trash/trash-service";
import type { Logger } from "../../logging/logger";

/**
 * The hourly retention sweep `silo serve` runs (D113), and what it logs.
 *
 * A sweep counts a receipt it could not purge rather than throwing, so the log
 * line is the only place an operator learns that one is stuck.
 */
export class TrashSweepTimer {
  /** Starts sweeping. `unref`, so a shutdown is not held open by the next sweep. */
  static start(
    trash: Pick<TrashService, "sweep">,
    logger: Pick<Logger, "info" | "warn">
  ): ReturnType<typeof setInterval> {
    const timer = setInterval(() => void TrashSweepTimer.runOnce(trash, logger), TrashDefaults.SweepIntervalMs);
    timer.unref?.();
    return timer;
  }

  /** One sweep and its log lines. Never throws. */
  static async runOnce(
    trash: Pick<TrashService, "sweep">,
    logger: Pick<Logger, "info" | "warn">
  ): Promise<void> {
    try {
      const result = await trash.sweep();
      if (result.purged > 0) {
        logger.info("purged expired trash", { count: result.purged });
      }
      if (result.failed > 0) {
        logger.warn("expired trash could not be purged; the next sweep tries again", {
          count: result.failed,
        });
      }
    } catch (caught: unknown) {
      logger.warn("trash sweep failed", {
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
}
