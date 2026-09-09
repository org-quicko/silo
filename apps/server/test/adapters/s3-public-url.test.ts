import { describe, expect, test } from "bun:test";
import { S3PublicUrl } from "../../src/adapters/blob/s3-public-url";

/**
 * The four ways a bucket's objects are addressed (D58), and the one key that
 * can decline to use any of them (D59).
 *
 * Worth pinning because all four are well-formed URLs and only one of them is
 * right for a given bucket: a virtual-hosted root against a path-style gateway
 * hands out links that 404 while every upload succeeds.
 *
 * `publicRead` is left unset everywhere except where it is the subject, so the
 * addressing cases run on the real default. That default is **on**: configuring
 * a bucket is the decision to let it deliver, and a media URL that names the
 * bucket is the point of moving the library there. The key exists only for the
 * bucket that is deliberately private, where readability genuinely cannot be
 * derived — it lives in a bucket policy silo never sees.
 */
describe("S3PublicUrl", () => {
  const bucket = (extra: Record<string, unknown> = {}) => ({
    bucket: "silo-media",
    ...extra,
  });

  test("AWS, virtual hosted — the default", () => {
    expect(S3PublicUrl.rootOf(bucket({ region: "ap-south-1" }))).toBe(
      "https://silo-media.s3.ap-south-1.amazonaws.com"
    );
  });

  test("AWS, path style", () => {
    expect(S3PublicUrl.rootOf(bucket({ region: "ap-south-1", forcePathStyle: true }))).toBe(
      "https://s3.ap-south-1.amazonaws.com/silo-media"
    );
  });

  test("no region falls back to the same default the client uses", () => {
    expect(S3PublicUrl.rootOf(bucket())).toBe("https://silo-media.s3.us-east-1.amazonaws.com");
  });

  test("an endpoint, path style — MinIO and most self hosted gateways", () => {
    expect(
      S3PublicUrl.rootOf(
        bucket({ endpoint: "https://minio.example.com:9000", forcePathStyle: true })
      )
    ).toBe("https://minio.example.com:9000/silo-media");
  });

  test("an endpoint, virtual hosted", () => {
    expect(S3PublicUrl.rootOf(bucket({ endpoint: "https://objects.example.com" }))).toBe(
      "https://silo-media.objects.example.com"
    );
  });

  test("an endpoint with no scheme is read as https rather than refused", () => {
    // Every provider's own documentation prints it this way, and the
    // alternative is a bucket that stores bytes and reports no public root.
    expect(
      S3PublicUrl.rootOf(bucket({ endpoint: "objects.example.com", forcePathStyle: true }))
    ).toBe("https://objects.example.com/silo-media");
  });

  test("no bucket has no public root", () => {
    expect(S3PublicUrl.rootOf({ bucket: "" })).toBeNull();
  });

  test("an unparseable endpoint has no public root rather than a guessed one", () => {
    expect(S3PublicUrl.rootOf(bucket({ endpoint: "http://" }))).toBeNull();
  });

  /**
   * Configuring a bucket is the decision to let it deliver.
   *
   * So the root is answered by default and `public_read` is the way *out* of it,
   * for a bucket that is deliberately private. Both halves are pinned because
   * both have been wrong in a shipped release: D58 offered no way out at all,
   * and D59 made the way out the default, so a configured bucket went on being
   * proxied by silo when naming it directly was the whole point of configuring
   * it.
   */
  describe("a configured bucket serves its own objects", () => {
    test("no public_read at all still answers the bucket", () => {
      expect(S3PublicUrl.rootOf({ bucket: "silo-media", region: "ap-south-1" })).toBe(
        "https://silo-media.s3.ap-south-1.amazonaws.com"
      );
    });

    test("only an explicit false takes silo back into the read path", () => {
      expect(
        S3PublicUrl.rootOf({ bucket: "silo-media", region: "ap-south-1", publicRead: false })
      ).toBeNull();
    });

    test("turning it off beats every addressing option", () => {
      // Nothing that shapes the URL can put the bucket back into the answer.
      expect(
        S3PublicUrl.rootOf({
          bucket: "silo-media",
          region: "ap-south-1",
          endpoint: "https://objects.example.com",
          forcePathStyle: true,
          publicRead: false,
        })
      ).toBeNull();
    });
  });
});
