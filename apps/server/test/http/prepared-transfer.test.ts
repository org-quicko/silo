import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { Scope } from "../../src/core/domain/scope";
import { SiloService } from "../../src/core/services/silo-service";
import { TransferPair } from "./support/transfer-pair";

/** A response body as JSON, untyped: each assertion says what it holds. */
const read = async (response: { json(): Promise<unknown> } | Promise<{ json(): Promise<unknown> }>): Promise<any> =>
  (await response).json();

/**
 * Prepared transfers on the destination (D109): pulled once, reviewed from
 * what was pulled, bound to the key that prepared them, and limited in number
 * and in time.
 */
describe("prepared transfer", () => {
  let pair: TransferPair;

  beforeEach(async () => {
    pair = await TransferPair.open();
    await pair.seed();
  });

  afterEach(async () => {
    setSystemTime();
    await pair.close();
  });

  const route = (id: string, rest = "") => `${TransferPair.Prepare}/${id}${rest}`;
  const files = async (id: string) => fs.readdir(path.join(pair.staging, "prepared", id));

  /** The NDJSON lines of a response, as they arrive. */
  async function* lines(response: Response): AsyncGenerator<any> {
    const decoder = new TextDecoder();
    let rest = "";
    for await (const chunk of response.body!) {
      rest += decoder.decode(chunk, { stream: true });
      for (let newline = rest.indexOf("\n"); newline >= 0; newline = rest.indexOf("\n")) {
        yield JSON.parse(rest.slice(0, newline));
        rest = rest.slice(newline + 1);
      }
    }
  }

  /** A source that sends two bytes of a package and then nothing, until it is cancelled. */
  const stalling = () => {
    const started = Promise.withResolvers<void>();
    const stopped = Promise.withResolvers<void>();
    const url = pair.serve(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0x1f, 0x8b]));
              started.resolve();
            },
            cancel() {
              stopped.resolve();
            },
          }),
          { headers: { "Content-Type": "application/gzip" } }
        )
    );
    return { url, started: started.promise, stopped: stopped.promise };
  };

  /** Prepares against a stalling source, answering the transfer's id once the pull is under way. */
  const preparing = async (url: string) => {
    const response = await pair.prepare(pair.body({ source: { url, api_key: "key" } }), pair.destinationKey, {
      Accept: "application/x-ndjson",
    });
    const stream = lines(response);
    const first = (await stream.next()).value;
    expect(first).toMatchObject({ type: "progress", phase: "fetch", transfer: { state: "preparing" } });
    return { id: first.transfer.id as string, stream };
  };

  test("holds exactly the picked entries and the media they use, page by page", async () => {
    const prepared = await pair.prepare(pair.body());
    expect(prepared.status).toBe(201);
    const view = await read(prepared);
    expect(view).toMatchObject({
      state: "prepared",
      from: { project: "acme", env: "dev" },
      to: { project: "acme", env: "uat" },
      mode: "merge",
      media: "referenced",
      package: {
        collections: [
          { name: "pages", entries: 1 },
          { name: "posts", entries: 1 },
        ],
        media_assets: 1,
        media_folders: 1,
        missing_media: [],
      },
    });
    const { home, picked } = pair.seeded;
    expect(view.entries.total).toBe(2);
    expect(view.entries.items.map((item: any) => `${item.collection}/${item.id}`)).toEqual([`pages/${home}`, `posts/${picked}`]);

    const second = await read(pair.call("GET", route(view.id, "?detail_offset=1&detail_limit=1")));
    expect(second.entries).toMatchObject({ offset: 1, limit: 1, total: 2 });
    expect(second.entries.items.map((item: any) => item.id)).toEqual([picked]);
  });

  test("shows each entry as it was pulled, whatever the source does next", async () => {
    const view = await read(pair.prepare(pair.body()));
    const dev = Scope.of("acme", "dev");
    const { picked, other } = pair.seeded;
    const current = await pair.sourceService.entries.get(dev, "posts", picked);
    await pair.sourceService.entries.update(dev, "posts", picked, { title: "edited" }, current.rev);

    const shown = await pair.call("GET", route(view.id, `/entries/posts/${picked}`));
    expect(shown.status).toBe(200);
    expect(await read(shown)).toMatchObject({ id: picked, rev: 1, title: "picked" });
    expect((await pair.call("GET", route(view.id, `/entries/posts/${other}`))).status).toBe(404);
  });

  test("never writes the source key down", async () => {
    const view = await read(pair.prepare(pair.body()));
    expect(JSON.stringify(view)).not.toContain(pair.sourceKey);

    const root = path.join(pair.staging, "prepared", view.id);
    const texts: string[] = [];
    for await (const name of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true, dot: true })) {
      texts.push(await Bun.file(path.join(root, name)).text());
    }
    expect(texts.some((text) => text.includes(view.source.url))).toBe(true);
    expect(texts.filter((text) => text.includes(pair.sourceKey))).toEqual([]);
  });

  test("answers only the key that prepared it, in the environment it was prepared for", async () => {
    const view = await read(pair.prepare(pair.body()));
    const other = (await pair.destinationService.keys.create("other root", [Claims.Root])).secret;
    for (const [method, address] of [
      ["GET", route(view.id)],
      ["GET", route(view.id, `/entries/posts/${pair.seeded.picked}`)],
      ["DELETE", route(view.id)],
    ]) {
      expect((await pair.call(method!, address!, other)).status).toBe(404);
    }
    expect((await pair.call("GET", `/api/projects/acme/envs/dev/transfers/${view.id}`)).status).toBe(404);
    expect(await read(pair.call("GET", route(view.id)))).toMatchObject({ state: "prepared" });
  });

  test("holds four at a time, and a cancelled one gives back its slot and its files", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
      const prepared = await pair.prepare(pair.body());
      expect(prepared.status).toBe(201);
      ids.push((await read(prepared)).id);
    }
    const refused = await pair.prepare(pair.body());
    expect(refused.status).toBe(429);
    expect((await read(refused)).error.code).toBe("too_many_transfers");
    expect((await pair.transferDirectories()).length).toBe(4);

    expect(await read(pair.call("DELETE", route(ids[0]!)))).toMatchObject({ state: "cancelled" });
    expect(await files(ids[0]!)).toEqual(["record.json"]);
    expect((await pair.call("GET", route(ids[0]!, `/entries/posts/${pair.seeded.picked}`))).status).toBe(404);
    expect((await pair.prepare(pair.body())).status).toBe(201);
  });

  test("expires an hour after it was prepared, dropping its package", async () => {
    const view = await read(pair.prepare(pair.body()));
    const prepared = Date.parse(view.updated_at);

    setSystemTime(new Date(prepared + 59 * 60 * 1000));
    expect(await read(pair.call("GET", route(view.id)))).toMatchObject({ state: "prepared" });

    setSystemTime(new Date(prepared + 61 * 60 * 1000));
    const expired = await read(pair.call("GET", route(view.id)));
    expect(expired.state).toBe("expired");
    expect(expired.entries).toBeUndefined();
    expect(await files(view.id)).toEqual(["record.json"]);
    expect((await pair.call("GET", route(view.id, `/entries/posts/${pair.seeded.picked}`))).status).toBe(404);
  });

  test("a cancel stops a pull that is still running", async () => {
    const source = stalling();
    const { id, stream } = await preparing(source.url);
    await source.started;

    expect(await read(pair.call("DELETE", route(id)))).toMatchObject({ state: "cancelled" });
    const remaining: any[] = [];
    for await (const line of stream) remaining.push(line);
    expect(remaining.at(-1)).toMatchObject({ type: "error", status: 409, error: { code: "transfer_cancelled" } });
    await source.stopped;
    expect(await files(id)).toEqual(["record.json"]);
  });

  test("a pull a stopped server left behind is removed by the next one", async () => {
    const source = stalling();
    const { id } = await preparing(source.url);
    await source.started;

    const restarted = TransferPair.app(
      new SiloService(pair.destinationService.store, {
        blobStorage: pair.destinationService.blobStorage,
        stagingDir: pair.staging,
      })
    );
    const read = await restarted.request(route(id), { headers: { Authorization: `Bearer ${pair.destinationKey}` } });
    expect(read.status).toBe(404);
    expect(await pair.transferDirectories()).toEqual([]);
  });

  test("asks for the claims the transfer exercises, at the destination", async () => {
    const writes = (collections: string[]) =>
      collections.flatMap((name) =>
        Claims.ScopeCopyWritePermissions.map((permission) => Claims.collection("acme", "uat", name, permission))
      );
    const replaces = Claims.ScopeCopyReplacePermissions.map((permission) => Claims.collection("acme", "uat", "pages", permission));
    const full = [Claims.TransferCopy, ...writes(["posts", "pages"])];
    const replacing = { mode: "replace", selection: [{ collection: "pages" }] };
    const cases: [string, string[], Record<string, unknown>, number][] = [
      ["everything it needs", [...full, Claims.MediaCreate], {}, 201],
      ["no transfer:copy", [...writes(["posts", "pages"]), Claims.MediaCreate], {}, 403],
      ["no write on one collection", [Claims.TransferCopy, ...writes(["posts"]), Claims.MediaCreate], {}, 403],
      ["media without media:create", full, {}, 403],
      ["no media and no media:create", full, { media: "none" }, 201],
      ["replace without the replace claims", [...full, Claims.MediaCreate], replacing, 403],
      ["replace with them", [...full, Claims.MediaCreate, ...replaces], replacing, 201],
    ];
    for (const [name, claims, overrides, status] of cases) {
      const key = (await pair.destinationService.keys.create(name, claims)).secret;
      expect([name, (await pair.prepare(pair.body(overrides), key)).status]).toEqual([name, status]);
    }
  });

  test("on storage that cannot apply it as one change, it refuses before reaching the source", async () => {
    const fsPair = await TransferPair.open({ destination: "fs" });
    try {
      await fsPair.seed();
      let reached = 0;
      const url = fsPair.serve(() => {
        reached++;
        return new Response("{}", { status: 500 });
      });
      const refused = await fsPair.prepare(fsPair.body({ source: { url, api_key: "key" } }));
      expect(refused.status).toBe(409);
      expect((await read(refused)).error.code).toBe("atomic_commit_unsupported");
      expect(reached).toBe(0);
      expect(await fsPair.transferDirectories()).toEqual([]);
    } finally {
      await fsPair.close();
    }
  });
});
