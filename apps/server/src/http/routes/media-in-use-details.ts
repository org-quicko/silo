import type { Context } from "hono";
import type { MediaInUseError } from "../../core/errors/media-in-use-error";
import type { MediaUsage } from "../../core/media/media-usage";
import type { SiloService } from "../../core/services/silo-service";
import { RouteAuth } from "../auth/route-auth";

/** How many referrers a refusal body enumerates before it just reports a
 *  count — shared by every route that can answer `media_in_use`. */
const UsageSample = 20;

/**
 * The claim-filtered "still in use" facts for one id: the true total, the
 * visible one, and the referrers the calling key may read.
 *
 * Shared by the single-delete `409`, the bulk delete route's per-id failure
 * entry, the recursive folder delete route, and purge — all four carry the
 * same facts, in bodies of their own shape (§8.1, D49).
 */
export class MediaInUseDetails {
  /** Whether the calling key may see a referrer at all. Anonymous callers get
   *  no enumeration — the count alone is public enough for a delete they were
   *  refused. */
  static readableBy(c: Context) {
    return (project: string, env: string, collection: string): boolean =>
      RouteAuth.canReadEntries(c, project, env, collection);
  }

  static async build(
    c: Context,
    service: SiloService,
    id: string,
    caught: MediaInUseError
  ): Promise<{ usage_count: number; visible_count: number; visible_capped: boolean; referrers: MediaUsage[] }> {
    const usage = await service.media.usages(id, { limit: UsageSample }, MediaInUseDetails.readableBy(c));
    return {
      usage_count: caught.usageCount,
      visible_count: usage.visible,
      visible_capped: usage.visibleCapped,
      referrers: usage.items,
    };
  }
}
