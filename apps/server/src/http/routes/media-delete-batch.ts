import { ValidationError } from "@silo/shared/validation-error";
import { MediaDeleteStalledError } from "../../core/errors/media-delete-stalled-error";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { SiloService } from "../../core/services/silo-service";
import type { DeleteOptions } from "../../core/trash/delete-options";

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
    inUseDetails: (id: string, caught: MediaInUseError) => Promise<Record<string, unknown>>,
    options: DeleteOptions = {}
  ): Promise<MediaDeleteBatchResult> {
    const deleted: string[] = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const id of ids) {
      try {
        await service.media.delete(id, { force, ...options });
        deleted.push(id);
      } catch (caught) {
        failed.push(await MediaDeleteBatch.describe(id, caught, inUseDetails));
      }
    }

    return { deleted, failed };
  }

  /** One id's failure in the batch shape. Shared with the recursive folder
   *  delete into the trash, which collects its failures itself. */
  static async describe(
    id: string,
    caught: unknown,
    inUseDetails: (id: string, caught: MediaInUseError) => Promise<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    if (caught instanceof MediaInUseError) {
      return { id, code: "media_in_use", message: caught.message, ...(await inUseDetails(id, caught)) };
    }
    if (caught instanceof NotFoundError) return { id, code: "not_found", message: caught.message };
    if (caught instanceof MediaDeleteStalledError) {
      return { id, code: "media_delete_stalled", message: caught.message };
    }
    if (caught instanceof ValidationError) return { id, code: "invalid_id", message: caught.message };
    // An error this cannot describe as one id's outcome — propagate rather than
    // folding it silently into the array.
    throw caught;
  }
}
