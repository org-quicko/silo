import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import fss from "fs";
import os from "os";
import path from "path";
import { ConfigLoader } from "../../config/config-loader";
import { FileSink } from "../../logging/file-sink";
import { Logger } from "../../logging/logger";
import { LogLevels } from "../../logging/log-level";
import { LogTail } from "../../logging/log-tail";

/**
 * The log is the only thing a detached server can tell you, so the properties
 * that matter are that a line reaches the file at all, that a level threshold
 * cannot swallow the one credential silo shows once, and that a server left up
 * for months cannot fill the disk.
 */
describe("Logger", () => {
  let dir: string;
  const config = (over: Record<string, unknown> = {}) => ({
    ...ConfigLoader.defaultConfig().log,
    ...over,
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-log-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const read = async (file: string) => fs.readFile(file, "utf8");

  test("writes to the configured file, creating missing parents", async () => {
    const file = path.join(dir, "nested", "silo.log");
    const logger = Logger.create(config({ file }));
    logger.info("listening", { listen: ":8090" });
    await logger.close();

    const body = await read(file);
    expect(body).toContain("INFO");
    expect(body).toContain("listening");
    expect(body).toContain("listen=:8090");
  });

  test("json format emits one parseable object per line", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file, format: "json" }));
    logger.warn("auth is disabled", { count: 2 });
    await logger.close();

    const lines = (await read(file)).trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({ level: "warn", msg: "auth is disabled", count: 2 });
    expect(Date.parse(parsed.ts)).not.toBeNaN();
  });

  test("the level threshold drops quieter messages", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file, level: "warn" }));
    logger.debug("compiling schema");
    logger.info("request");
    logger.warn("kept");
    logger.error("kept too");
    await logger.close();

    const body = await read(file);
    expect(body).not.toContain("compiling schema");
    expect(body).not.toContain("request");
    expect(body).toContain("kept");
    expect(body).toContain("kept too");
  });

  test("silent drops everything a level can drop", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file, level: LogLevels.Silent }));
    logger.error("not written");
    await logger.close();
    expect((await read(file)).trim()).toBe("");
  });

  /**
   * The root key is printed exactly once in the life of an instance (§8). A
   * `[log] level` that filtered it away would lose it for good, so `raw` goes
   * past the threshold on purpose.
   */
  test("raw output survives even a silent logger", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file, level: LogLevels.Silent }));
    logger.raw("ROOT API KEY silo_abc\n");
    await logger.close();
    expect(await read(file)).toContain("silo_abc");
  });

  test("an unknown level falls back to info rather than logging nothing", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file, level: "verbose" }));
    logger.info("still here");
    logger.debug("but not this");
    await logger.close();

    const body = await read(file);
    expect(body).toContain("still here");
    expect(body).not.toContain("but not this");
  });

  test("values with spaces stay one field", async () => {
    const file = path.join(dir, "silo.log");
    const logger = Logger.create(config({ file }));
    logger.info("started", { data: "/srv/my silo", driver: "sqlite" });
    await logger.close();
    expect(await read(file)).toContain('data="/srv/my silo" driver=sqlite');
  });
});

describe("FileSink rotation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-rotate-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("rotates past the size cap and keeps at most max_files generations", async () => {
    const file = path.join(dir, "silo.log");
    // One byte of cap, so every write past the first rotates.
    const sink = FileSink.open(file, 1 / (1024 * 1024), 2);
    for (let i = 0; i < 5; i++) sink.write(`line ${i}`);
    await sink.close();

    expect(fss.existsSync(file)).toBe(true);
    expect(fss.existsSync(`${file}.1`)).toBe(true);
    expect(fss.existsSync(`${file}.2`)).toBe(true);
    // Beyond max_files the oldest generation is dropped, not accumulated.
    expect(fss.existsSync(`${file}.3`)).toBe(false);
    // The live file holds the newest line.
    expect(await fs.readFile(file, "utf8")).toContain("line 4");
  });

  test("max_size_mb = 0 never rotates", async () => {
    const file = path.join(dir, "silo.log");
    const sink = FileSink.open(file, 0, 5);
    for (let i = 0; i < 200; i++) sink.write(`line ${i}`);
    await sink.close();

    expect(fss.existsSync(`${file}.1`)).toBe(false);
    expect((await fs.readFile(file, "utf8")).trim().split("\n")).toHaveLength(200);
  });

  test("reopening an existing log appends rather than truncating", async () => {
    const file = path.join(dir, "silo.log");
    const first = FileSink.open(file, 0, 5);
    first.write("from the first run");
    await first.close();

    const second = FileSink.open(file, 0, 5);
    second.write("from the second");
    await second.close();

    const body = await fs.readFile(file, "utf8");
    expect(body).toContain("from the first run");
    expect(body).toContain("from the second");
  });
});

describe("LogTail", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-tail-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("reads the last n lines, whole", async () => {
    const file = path.join(dir, "silo.log");
    await fs.writeFile(file, Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const tail = LogTail.read(file, 3);
    expect(tail).toEqual(["line 497", "line 498", "line 499"]);
  });

  test("a missing file tails to nothing instead of throwing", () => {
    expect(LogTail.read(path.join(dir, "absent.log"), 10)).toEqual([]);
  });

  /** A rotation moves the live file out from under a follow; the size going
   *  backwards is the only signal, and the reader has to restart from the head
   *  rather than seek past the end of a smaller file. */
  test("following restarts from the head when the file shrinks", async () => {
    const file = path.join(dir, "silo.log");
    await fs.writeFile(file, "aaaa\nbbbb\ncccc\n");
    const offset = LogTail.size(file);

    await fs.writeFile(file, "fresh\n");
    const { text } = LogTail.since(file, offset);
    expect(text).toBe("fresh\n");
  });

  test("following returns only what was appended", async () => {
    const file = path.join(dir, "silo.log");
    await fs.writeFile(file, "one\n");
    const first = LogTail.size(file);
    await fs.appendFile(file, "two\n");

    const { text, offset } = LogTail.since(file, first);
    expect(text).toBe("two\n");
    expect(LogTail.since(file, offset).text).toBe("");
  });
});
