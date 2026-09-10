import { RowStream } from "../pagination/row-stream.js";
import type { MediaAsset } from "./media-asset.js";

/** `Media.all()`'s async-iterable: one `MediaAsset` at a time, paging by the
 * window the server echoes. No behaviour of its own — the named type
 * is what `Media.all()` answers. */
export class MediaStream extends RowStream<MediaAsset> {}
