import path from "path";

export class MimeUtils {
  private static readonly mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
  };

  static lookup(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return this.mimeTypes[ext] || "application/octet-stream";
  }
}
