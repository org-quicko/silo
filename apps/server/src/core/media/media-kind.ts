export type MediaKindName = "image" | "video" | "audio" | "document" | "other";

/** The broad kind of a file, read off its content type, for the library's stats. */
export class MediaKind {
  private static readonly Documents = [
    "text/",
    "application/pdf",
    "application/json",
    "application/xml",
    "application/rtf",
    "application/msword",
    "application/vnd.ms-",
    "application/vnd.openxmlformats-officedocument.",
    "application/vnd.oasis.opendocument.",
  ];

  static of(contentType: string): MediaKindName {
    const type = contentType.toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    if (MediaKind.Documents.some((prefix) => type.startsWith(prefix))) return "document";
    return "other";
  }
}
