import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import { SiloService } from "../../src/core/services/silo-service";
import { TransferPair } from "./support/transfer-pair";

const Child = path.join(import.meta.dir, "support", "transfer-recovery-child.ts");

/**
 * A transfer the process died in (D109, D111), settled when the server starts
 * again. A real process is killed at the point named, so what is on disk is
 * what a crash leaves, with no old pull still writing into it.
 */
describe("a transfer the process died in", () => {
  /** Runs the child to `stop`, kills it there, and answers its transfer. */
  async function killedAt(directory: string, stop: "during-pull" | "after-files" | "after-commit") {
    const child = Bun.spawn([process.execPath, Child, directory, stop], { stdout: "pipe", stderr: "pipe" });
    const seen: string[] = [];
    let ready: string[] | undefined;
    const decoder = new TextDecoder();
    let rest = "";
    try {
      for await (const chunk of child.stdout) {
        rest += decoder.decode(chunk, { stream: true });
        for (let newline = rest.indexOf("\n"); newline >= 0; newline = rest.indexOf("\n")) {
          const line = rest.slice(0, newline).trim();
          rest = rest.slice(newline + 1);
          seen.push(line);
          if (line.startsWith("READY ")) ready = line.split(" ").slice(1);
          if (line === "STOPPED" && ready) return { id: ready[0]!, key: ready[1]! };
        }
      }
      throw new Error(`the child ended before it stopped: ${seen.join(" | ")} ${await new Response(child.stderr).text()}`);
    } finally {
      child.kill();
      await child.exited;
    }
  }

  /** The destination opened again, as a restart opens it, then settled. */
  async function restarted(directory: string) {
    const store = await SqliteStore.open(path.join(directory, "destination.db"));
    const service = new SiloService(store, {
      blobStorage: new FsBlobStorage(path.join(directory, "destination-media")),
      stagingDir: path.join(directory, "destination-transfer"),
    });
    return { store, service, settled: await service.preparedTransfers.resumeInterrupted() };
  }

  test("a pull a stopped server left behind is removed by the next one", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-recovery-test-"));
    try {
      const { id, key } = await killedAt(directory, "during-pull");
      const prepared = path.join(directory, "destination-transfer", "prepared");
      expect(await Bun.file(path.join(prepared, id, "record.json")).json()).toMatchObject({ id, state: "preparing" });

      const destination = await restarted(directory);
      try {
        const app = TransferPair.app(destination.service);
        const response = await app.request(`${TransferPair.Prepare}/${id}`, { headers: { Authorization: `Bearer ${key}` } });
        expect(response.status).toBe(404);
        expect(await fs.readdir(prepared)).toEqual([]);
      } finally {
        await destination.store.close();
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  const cases: ["after-files" | "after-commit", { applied: number; restored: number; pending: number }, string][] = [
    ["after-files", { applied: 0, restored: 1, pending: 0 }, "prepared"],
    ["after-commit", { applied: 1, restored: 0, pending: 0 }, "applied"],
  ];
  for (const [stop, settled, state] of cases) {
    test(`killed ${stop.replace("-", " ")}, it is settled as ${state}`, async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "silo-recovery-test-"));
      try {
        const { id, key } = await killedAt(directory, stop);
        const destination = await restarted(directory);
        try {
          expect(destination.settled).toEqual(settled);
          const app = TransferPair.app(destination.service);
          const route = `${TransferPair.Prepare}/${id}`;
          const view = (await (await app.request(route, { headers: { Authorization: `Bearer ${key}` } })).json()) as any;
          expect(view.state).toBe(state);
          const files = await destination.service.blobStorage.list();
          const uat = Scope.of("acme", "uat");

          if (state === "applied") {
            expect(files.length).toBe(1);
            expect((await destination.store.get(Scope.System, "_transfers", id)).id).toBe(id);
            expect((await destination.store.listCollections(uat)).map((collection) => collection.name).sort()).toEqual(["pages", "posts"]);
            return;
          }
          // Nothing landed, the file it wrote is taken back, and it can be applied again.
          expect(view.last_error).toContain("interrupted");
          expect(files).toEqual([]);
          await expect(destination.store.get(Scope.System, "_transfers", id)).rejects.toBeInstanceOf(NotFoundError);
          expect(await destination.store.listCollections(uat)).toEqual([]);
          const applied = await app.request(`${route}/apply`, { method: "POST", headers: { Authorization: `Bearer ${key}` } });
          expect(applied.status).toBe(200);
          expect((await destination.service.blobStorage.list()).length).toBe(1);
        } finally {
          await destination.store.close();
        }
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }, 60_000);
  }
});
