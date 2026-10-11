/** Every bulk download slot is streaming (D106): HTTP 503 with `Retry-After`. */
export class MediaArchiveBusyError extends Error {
  static readonly RetryAfterSeconds = 30;

  constructor(streams: number) {
    super(
      `the server is already sending ${streams} ${streams === 1 ? "download" : "downloads"}, ` +
        `the most [media] download_max_streams allows; try again shortly`
    );
    this.name = "MediaArchiveBusyError";
  }
}
