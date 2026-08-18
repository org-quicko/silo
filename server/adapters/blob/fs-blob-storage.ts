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

  async put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
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
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }


  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
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
    } catch (err: any) {
      if (err.code === "ENOENT") return;
      throw err;
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
