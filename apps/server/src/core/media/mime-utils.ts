import path from "path";

/**
 * A filename's content type, read off its extension and nothing else (D83).
 *
 * The table is what the library serves and stores as `content_type`. It has to
 * cover every extension in `MediaDefaults` and the ones an operator is likely
 * to add, because since D83 the type a client *declares* for an upload is not
 * consulted at all — a multipart part carries whatever type the sender chose,
 * and a type silo cannot derive is `application/octet-stream`, which a browser
 * downloads and never renders.
 */
export class MimeUtils {
  private static readonly mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
  };

  static lookup(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return this.mimeTypes[ext] || "application/octet-stream";
  }
}
