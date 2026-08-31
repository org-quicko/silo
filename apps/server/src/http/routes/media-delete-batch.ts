import { ValidationError } from "@silo/shared/validation-error";
import { MediaDeleteStalledError } from "../../core/errors/media-delete-stalled-error";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { SiloService } from "../../core/services/silo-service";

/** The body shape `POST /api/media/delete` answers with — shared by every
 *  route that deletes many assets at once, so a recursive folder delete and a
 *  purge report the same per-id outcomes rather than a shape of their own
 *  (D49). */
export interface MediaDeleteBatchResult {
  deleted: string[];
  failed: Array<Record<string, unknown>>;
}

/**
 * The per-id delete loop `POST /api/media/delete` runs, factored out so the
 * recursive folder delete and the purge route reuse it rather than inventing
 * a second failure shape.
 *
 * Sequential, not `Promise.all`: each id takes its own write lock in its own
 * turn, so a large batch never holds one lock over the whole request.
 */
export class MediaDeleteBatch {
  static async run(
    service: SiloService,
    ids: readonly string[],
    force: boolean,
    inUseDetails: (id: string, caught: MediaInUseError) => Promise<Record<string, unknown>>
  ): Promise<MediaDeleteBatchResult> {
    const deleted: string[] = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const id of ids) {
      try {
        await service.media.delete(id, { force });
        deleted.push(id);
      } catch (caught) {
        if (caught instanceof MediaInUseError) {
          failed.push({
            id,
            code: "media_in_use",
            message: caught.message,
            ...(await inUseDetails(id, caught)),
          });
        } else if (caught instanceof NotFoundError) {
          failed.push({ id, code: "not_found", message: caught.message });
        } else if (caught instanceof MediaDeleteStalledError) {
          failed.push({ id, code: "media_delete_stalled", message: caught.message });
        } else if (caught instanceof ValidationError) {
          failed.push({ id, code: "invalid_id", message: caught.message });
        } else {
          // An error this loop does not know how to describe as one id's
          // outcome — propagate rather than folding it silently into the array.
          throw caught;
        }
      }
    }

    return { deleted, failed };
  }
}
