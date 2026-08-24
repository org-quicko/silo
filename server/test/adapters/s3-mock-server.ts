/**
 * An in-memory S3-compatible server, just complete enough to drive
 * `S3BlobStorage` over a real socket.
 *
 * This replaced a hand-written double for the AWS SDK's `send(command)` when
 * the adapter moved to Bun's built-in `S3Client` (which has no such seam), and
 * the swap is an improvement rather than a workaround: the double could only
 * prove the adapter *called* the SDK the way the test expected it to, whereas
 * this exercises request signing, URL addressing, XML parsing and pagination —
 * the parts the adapter no longer owns and therefore can no longer be trusted
 * to have got right by inspection.
 */
export interface S3MockObject {
  body: Uint8Array;
  contentType?: string;
}

export class S3MockServer {
  /** The bucket this server answers for. Requests arrive either as
   *  `/<bucket>/<key>` or as `/<key>`, depending on the addressing mode under
   *  test, so the name is what tells the two apart. */
  static readonly Bucket = "silo-test";

  private readonly server: ReturnType<typeof Bun.serve>;
  /** Every object the server holds, keyed exactly as S3 would key it. */
  readonly objects = new Map<string, S3MockObject>();
  /** `METHOD /path?query` for every request served, in order. */
  readonly requests: string[] = [];
  /** Number of keys one `ListObjectsV2` may return; S3's own cap is 1000. */
  maxKeysPerPage = 1000;

  private constructor() {
    this.server = Bun.serve({ port: 0, fetch: (req) => this.handle(req) });
  }

  static start(): S3MockServer {
    return new S3MockServer();
  }

  get endpoint(): string {
    return `http://localhost:${this.server.port}`;
  }

  stop(): void {
    this.server.stop(true);
  }

  private handle(req: Request): Response | Promise<Response> {
    const url = new URL(req.url);
    this.requests.push(`${req.method} ${url.pathname}${url.search}`);

    // Path-style puts the bucket in the first segment; virtual-hosted leaves
    // it out. Stripping it only when it is actually there lets one server
    // answer both, which is what makes the addressing-mode test possible.
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] === S3MockServer.Bucket) segments.shift();
    const key = decodeURIComponent(segments.join("/"));

    if (req.method === "GET" && key === "") return this.listObjects(url);
    if (req.method === "PUT") return this.putObject(req, key);
    if (req.method === "DELETE") {
      this.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return this.getObject(req, key);
  }

  private async putObject(req: Request, key: string): Promise<Response> {
    this.objects.set(key, {
      body: new Uint8Array(await req.arrayBuffer()),
      contentType: req.headers.get("content-type") ?? undefined,
    });
    return new Response(null, { status: 200, headers: { ETag: '"mock"' } });
  }

  private getObject(req: Request, key: string): Response {
    const object = this.objects.get(key);
    if (!object) {
      const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>${S3MockServer.escape(key)}</Key></Error>`;
      return new Response(req.method === "HEAD" ? null : body, {
        status: 404,
        headers: { "content-type": "application/xml" },
      });
    }
    return new Response(req.method === "HEAD" ? null : object.body, {
      headers: {
        "content-type": object.contentType ?? "application/octet-stream",
        "content-length": String(object.body.length),
        "last-modified": "Mon, 24 Aug 2026 10:00:00 GMT",
        ETag: '"mock"',
      },
    });
  }

  /** `ListObjectsV2`, including the truncation and continuation tokens the
   *  adapter has to follow to see past the first page. */
  private listObjects(url: URL): Response {
    const prefix = url.searchParams.get("prefix") ?? "";
    const token = url.searchParams.get("continuation-token") ?? "";
    const limit = Math.min(Number(url.searchParams.get("max-keys") ?? this.maxKeysPerPage), this.maxKeysPerPage);

    const matching = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = token ? matching.indexOf(token) + 1 : 0;
    const page = matching.slice(start, start + limit);
    const truncated = start + limit < matching.length;

    const contents = page
      .map(
        (k) =>
          `<Contents><Key>${S3MockServer.escape(k)}</Key><Size>${this.objects.get(k)!.body.length}</Size>` +
          `<LastModified>2026-08-24T10:00:00.000Z</LastModified><ETag>&quot;mock&quot;</ETag></Contents>`
      )
      .join("");

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Name>${S3MockServer.Bucket}</Name><Prefix>${S3MockServer.escape(prefix)}</Prefix>
<KeyCount>${page.length}</KeyCount><MaxKeys>${limit}</MaxKeys><IsTruncated>${truncated}</IsTruncated>
${truncated ? `<NextContinuationToken>${S3MockServer.escape(page[page.length - 1]!)}</NextContinuationToken>` : ""}
${contents}
</ListBucketResult>`,
      { headers: { "content-type": "application/xml" } }
    );
  }

  private static escape(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
