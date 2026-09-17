import { describe, test, expect } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { x } from "tar";
import { TarHeader } from "../../src/core/transfer/tar/tar-header";
import { TarWriter } from "../../src/core/transfer/tar/tar-writer";

/** Collects a writer's output, since the writer itself holds nothing. */
const capture = async (
  write: (writer: TarWriter) => Promise<void>,
  mtime = new Date("2026-09-17T00:00:00Z")
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const writer = new TarWriter((chunk) => {
    chunks.push(new Uint8Array(chunk));
  }, mtime);
  await write(writer);
  await writer.finish();

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** Extracts through the same library the importer reads archives with. */
const extract = async (archive: Uint8Array): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-tar-test-"));
  const tarPath = path.join(directory, "archive.tar");
  await fs.writeFile(tarPath, archive);
  await x({ file: tarPath, cwd: directory });
  await fs.rm(tarPath);
  return directory;
};

describe("TarWriter", () => {
  test("round trips through the reader the importer uses", async () => {
    const archive = await capture(async (writer) => {
      await writer.addText("manifest.json", '{"format_version":"1"}');
      await writer.addText("projects/site/prod/schemas/posts.schema.json", '{"type":"object"}');
      await writer.addFile("media/01M22WG4RRB7N4NY5SSP5AAK51", new Uint8Array([1, 2, 3, 250]));
    });

    const directory = await extract(archive);
    try {
      expect(await fs.readFile(path.join(directory, "manifest.json"), "utf8")).toBe(
        '{"format_version":"1"}'
      );
      expect(
        await fs.readFile(path.join(directory, "projects/site/prod/schemas/posts.schema.json"), "utf8")
      ).toBe('{"type":"object"}');
      expect([
        ...(await fs.readFile(path.join(directory, "media/01M22WG4RRB7N4NY5SSP5AAK51"))),
      ]).toEqual([1, 2, 3, 250]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("a path longer than the ustar name field survives, via its PAX record", async () => {
    // Every segment is legal on its own; together they pass 100 bytes, which is
    // what a real `projects/<project>/<env>/content/<collection>/<id>.json`
    // does with unremarkable names.
    const long = `projects/${"p".repeat(60)}/${"e".repeat(60)}/content/posts/01M22WG4RRB7N4NY5SSP5AAK51.json`;
    expect(long.length).toBeGreaterThan(TarHeader.MaxNameLength);

    const directory = await extract(await capture((writer) => writer.addText(long, '{"id":"kept"}')));
    try {
      expect(await fs.readFile(path.join(directory, long), "utf8")).toBe('{"id":"kept"}');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("an empty directory is carried, which is what an empty scope is", async () => {
    const directory = await extract(
      await capture((writer) => writer.addDirectory("projects/site/staging"))
    );
    try {
      expect((await fs.stat(path.join(directory, "projects/site/staging"))).isDirectory()).toBe(true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("identical content written twice is identical bytes", async () => {
    // The property §7.1 claims. Staging through real files could never deliver
    // it — the staged files' mtimes are the clock — so it is the caller's
    // `exportedAt` that is stamped on every entry.
    const write = (writer: TarWriter) => writer.addText("manifest.json", '{"a":1}');
    expect(await capture(write)).toEqual(await capture(write));
  });

  test("a data block is padded to the 512-byte boundary", async () => {
    const archive = await capture((writer) =>
      writer.addFile("media/x", new Uint8Array(513).fill(7))
    );
    // header + two data blocks + two zero blocks that end the archive.
    expect(archive.length).toBe(TarHeader.BlockSize * 5);
  });

  test("finish is idempotent, so an error path may call it", async () => {
    const chunks: Uint8Array[] = [];
    const writer = new TarWriter((chunk) => {
      chunks.push(new Uint8Array(chunk));
    }, new Date(0));
    await writer.finish();
    await writer.finish();
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(TarHeader.BlockSize * 2);
  });
});

describe("TarHeader", () => {
  test("the checksum is computed over the field read as spaces", async () => {
    const block = TarHeader.build({
      path: "manifest.json",
      size: 10,
      type: TarHeader.TypeFile,
      mode: 0o644,
      mtime: new Date("2026-09-17T00:00:00Z"),
    });

    let sum = 0;
    for (let index = 0; index < block.length; index++) {
      sum += index >= 148 && index < 156 ? 0x20 : block[index]!;
    }
    const stored = new TextDecoder().decode(block.subarray(148, 154));
    expect(parseInt(stored, 8)).toBe(sum);
  });

  test("a PAX record declares a length that counts its own digits", () => {
    const record = new TextDecoder().decode(TarHeader.extendedRecord("path", "a".repeat(200)));
    expect(record).toMatch(/^\d+ path=a+\n$/);
    expect(Number(record.split(" ")[0])).toBe(record.length);
  });
});
