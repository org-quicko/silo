/**
 * Whether an asset is shown or saved when its URL is opened directly (D83).
 *
 * Images, video, audio and PDF are what a media library is for and what a
 * browser renders without running anything, so they stay `inline`. Everything
 * else is `attachment`: an SVG, because it is an XML document that may carry
 * script and is the one image type a browser will execute; and any type an
 * operator allowed past the defaults, because silo cannot know whether a
 * browser treats it as a page. A subresource load ignores the disposition — an
 * `<img src="/media/x.svg">` still draws — so this costs an embed nothing and
 * takes a navigation's script away. `ResponseSandbox` is the second lock on the
 * same door.
 */
export class MediaDisposition {
  private static readonly Shown = ["image/", "video/", "audio/"];

  static of(contentType: string): "inline" | "attachment" {
    const type = contentType.toLowerCase();
    if (type.startsWith("image/svg")) return "attachment";
    if (type.startsWith("application/pdf")) return "inline";
    return MediaDisposition.Shown.some((prefix) => type.startsWith(prefix)) ? "inline" : "attachment";
  }

  /** The `Content-Disposition` value, naming the file when there is a name. */
  static header(contentType: string, filename?: string): string {
    const kind = MediaDisposition.of(contentType);
    return filename ? `${kind}; filename*=UTF-8''${encodeURIComponent(filename)}` : kind;
  }
}
