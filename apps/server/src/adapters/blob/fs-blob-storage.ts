import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { BlobStorage, BlobItem, BlobPutOptions, BlobGetResult } from "../../core/ports/blob-storage";
import { MimeUtils } from "../../core/media/mime-utils";

export class FsBlobStorage implements BlobStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolvePath(key: string): string {
    const fullPath = path.resolve(this.baseDir, key);
    if (!fullPath.startsWith(this.baseDir + path.sep) && fullPath !== this.baseDir) {
      throw new Error(`Invalid blob key traversal: ${key}`);
    }
    return fullPath;
  }

  /**
   * Writes bytes to a temp sibling and renames over the key, so a key never
   * observably holds a partial object (D67).
   *
   * A plain `writeFile` truncates and then writes, which was harmless while
   * every key was written exactly once: a crash mid-write left bytes nothing
   * pointed at yet. Replace makes an overwrite an ordinary operation, and
   * there the same crash leaves a *catalogued* asset truncated, with the
   * record's `hash` and `size` still describing what used to be there.
   * `reconcile` would not catch it either — it asks whether a blob exists,
   * not whether it is the one the record describes. S3 `PUT` is already
   * atomic, so this brings the fs driver to what the other one always did.
   *
   * The temp name is deliberately not derived from the key: a hard crash
   * between write and rename leaves it behind, and `MediaReconciler` adopts a
   * stray blob whose name parses as the pre-D23 `<sha256>_<name>` shape.
   * Nothing here contains an underscore, so a leftover is reported as an
   * orphan rather than adopted as an asset.
   */
  async put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tempPath = path.join(
      path.dirname(filePath),
      `.silo-put-${crypto.randomBytes(8).toString("hex")}.tmp`
    );
    try {
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async get(key: string): Promise<BlobGetResult | null> {
    const filePath = this.resolvePath(key);
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return null;
      const buffer = await fs.readFile(filePath);
      return {
        data: new Uint8Array(buffer),
        contentType: MimeUtils.lookup(key),
        size: stats.size,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }


  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async list(prefix: string = ""): Promise<BlobItem[]> {
    const results: BlobItem[] = [];
    await this.scanDir(this.baseDir, "", prefix, results);
    return results.sort((a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0));
  }

  private async scanDir(currentDir: string, relativeDir: string, prefix: string, results: BlobItem[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error: any) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryRelPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await this.scanDir(fullPath, entryRelPath, prefix, results);
      } else if (entry.isFile()) {
        if (!prefix || entryRelPath.startsWith(prefix)) {
          const stats = await fs.stat(fullPath);
          results.push({
            key: entryRelPath,
            size: stats.size,
            lastModified: stats.mtime,
          });
        }
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No-op for filesystem adapter
  }
}
