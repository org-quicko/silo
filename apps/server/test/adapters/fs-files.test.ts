import { expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { FsFiles } from "../../src/adapters/storage/fs/fs-files";

// Windows refuses to rename a folder while a file in it is open, which is what
// a virus scan of a freshly extracted transfer package does for a moment.
test.skipIf(process.platform !== "win32")("a folder renames once a brief hold on a file in it ends", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fs-files-"));
  try {
    await fs.mkdir(path.join(work, "staged"));
    await fs.writeFile(path.join(work, "staged", "entry.json"), "{}");
    const held = await fs.open(path.join(work, "staged", "entry.json"), "r");
    setTimeout(() => void held.close(), 50);

    await FsFiles.rename(path.join(work, "staged"), path.join(work, "package"));
    expect(await fs.readFile(path.join(work, "package", "entry.json"), "utf8")).toBe("{}");
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});
