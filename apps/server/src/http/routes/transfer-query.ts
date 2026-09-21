import type { Context } from "hono";
import { MediaModes, type MediaMode } from "../../core/transfer/media-mode";
import { TransferSelection } from "../../core/transfer/transfer-selection";

/**
 * The two query parameters the archive routes share.
 *
 * `include` is repeatable rather than comma-separated so a value never has to
 * be escaped against its own separator, and so a selection reads the same in a
 * browser address bar as it does in `curl`:
 *
 *     /api/export?include=site/prod/posts&include=blog&media=referenced
 */
export class TransferQuery {
  static selection(c: Context): TransferSelection {
    return TransferSelection.parse(c.req.queries("include") ?? []);
  }

  /** Validated against the selection's breadth, which decides the default. */
  static media(c: Context, selection: TransferSelection): MediaMode {
    return MediaModes.parse(c.req.query("media"), !selection.isEverything);
  }
}
