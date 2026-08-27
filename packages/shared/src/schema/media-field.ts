/**
 * The `x-silo-type: "media"` schema keyword marking a field as a media
 * reference. The server rewrites these into absolute URLs on read and the admin
 * UI renders them with the media picker, so both need the same marker.
 *
 * Note the UI additionally treats `x-silo-ui.widget === "media"` and a few
 * format hints as media *for rendering purposes*; that is a UI presentation
 * choice layered on top of this keyword, not part of it.
 */
export class MediaField {
  static readonly TypeKeyword = "x-silo-type";
  static readonly MediaType = "media";

  static is(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    return (node as Record<string, unknown>)[MediaField.TypeKeyword] === MediaField.MediaType;
  }
}
