import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import { ArchiveTooLargeError } from "../../src/core/errors/archive-too-large-error";
import { ArchiveExtractor } from "../../src/core/transfer/archive-extractor";
import { Exporter } from "../../src/core/transfer/exporter";
import { ImportLimits } from "../../src/core/transfer/import-limits";
import { Importer } from "../../src/core/transfer/importer";
import { TransferDefaults } from "../../src/config/transfer-defaults";

/**
 * A streamed archive is held to two ceilings (D85): what it weighs, and what
 * it expands to on disk. The 2026-09-18 audit's H4: a 128 MB `.tar.gz` can
 * inflate to over a hundred gigabytes onto the disk the database shares, and
 * nothing stopped it before `ENOSPC` did.
 */
describe("import limits", () => {
  let tempDir: string;
  let source: SqliteStore;
  let destination: SqliteStore;
  let staging: string;

  const megabyte = 1024 * 1024;
  const scope = Scope.Default;

  const entry = (data: unknown): Entry => ({
    id: EntryUtils.newID(),
    project: scope.project,
    env: scope.env,
    collection: "posts",
    rev: 1,
    seq: 0,
    created_at: new Date(Date.UTC(2026, 0, 1)),
    updated_at: new Date(Date.UTC(2026, 0, 1)),
    data,
  });

  /** The source, exported to a tarball, as the stream an upload would be. */
  const exported = async (): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number }> => {
    const tarball = path.join(tempDir, "archive.tar.gz");
    await Exporter.exportTarGz(source, tarball, {});
    const bytes = await fs.readFile(tarball);
    return { stream: new Response(bytes).body!, bytes: bytes.byteLength };
  };

  const leftInStaging = async (): Promise<string[]> => {
    try {
      return await fs.readdir(staging);
    } catch {
      return [];
    }
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-limits-"));
    staging = path.join(tempDir, "staging");
    source = await SqliteStore.open(path.join(tempDir, "source.db"));
    destination = await SqliteStore.open(path.join(tempDir, "destination.db"));
    await source.putSchema(scope, "posts", { type: "object" });
  });

  afterEach(async () => {
    await source.close();
    await destination.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("an archive that expands past the ceiling is refused before it is written, and leaves nothing", async () => {
    // Three megabytes of one letter compress to almost nothing: a small
    // archive, a large tree.
    await source.put(entry({ body: "a".repeat(3 * megabyte) }), { usages: [], search: null });
    const { stream, bytes } = await exported();
    expect(bytes).toBeLessThan(megabyte / 4);

    const refused = Importer.importTarGzStream(destination, stream, {
      stagingDirectory: staging,
      limits: new ImportLimits(1024 * megabyte, megabyte),
    });
    await refused.catch(() => {});
    await expect(refused).rejects.toBeInstanceOf(ArchiveTooLargeError);
    await expect(refused).rejects.toThrow(/max_extracted_size_mb/);

    expect(await leftInStaging()).toEqual([]);
    expect((await destination.listCollections(scope)).map((record) => record.name)).not.toContain("posts");
  });

  test("an archive larger than the archive ceiling is refused while it arrives", async () => {
    await source.put(entry({ title: "small" }), { usages: [], search: null });
    const { stream } = await exported();

    const refused = Importer.importTarGzStream(destination, stream, {
      stagingDirectory: staging,
      limits: new ImportLimits(16, 1024 * megabyte),
    });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/max_archive_size_mb/);
    expect(await leftInStaging()).toEqual([]);
  });

  test("many tiny files cost a block each, so an inode bomb is refused on bytes it never had", async () => {
    for (let index = 0; index < 300; index++) {
      await source.put(entry({ index }), { usages: [], search: null });
    }
    const { stream } = await exported();

    // Three hundred entries of a few dozen bytes each, charged at
    // `ArchiveExtractor.cost`, is well over a megabyte.
    expect(300 * ArchiveExtractor.cost(0)).toBeGreaterThan(megabyte);
    const refused = Importer.importTarGzStream(destination, stream, {
      stagingDirectory: staging,
      limits: new ImportLimits(1024 * megabyte, megabyte),
    });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/max_extracted_size_mb/);
  });

  test("within both ceilings the archive loads, and with no limits it is unbounded", async () => {
    await source.put(entry({ body: "a".repeat(3 * megabyte) }), { usages: [], search: null });

    const bounded = await Importer.importTarGzStream(destination, (await exported()).stream, {
      stagingDirectory: staging,
      limits: new ImportLimits(64 * megabyte, 64 * megabyte),
    });
    expect(bounded.added).toBe(1);

    const unbounded = await Importer.importTarGzStream(destination, (await exported()).stream, {
      stagingDirectory: staging,
    });
    expect(unbounded.added + unbounded.updated + unbounded.skipped).toBe(1);
    expect(await leftInStaging()).toEqual([]);
  });

  test("the config speaks in megabytes and the limits in bytes", () => {
    const limits = ImportLimits.of({ max_archive_size_mb: 2, max_extracted_size_mb: 3.5 });
    expect(limits.maxArchiveBytes).toBe(2 * megabyte);
    expect(limits.maxExtractedBytes).toBe(Math.ceil(3.5 * megabyte));
    expect(ImportLimits.megabytes(limits.maxArchiveBytes)).toBe(2);

    expect(TransferDefaults.sizeMb(0, 7)).toBe(7);
    expect(TransferDefaults.sizeMb(-1, 7)).toBe(7);
    expect(TransferDefaults.sizeMb(Number.NaN, 7)).toBe(7);
    expect(TransferDefaults.sizeMb(12, 7)).toBe(12);
  });
});
