import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Daemon } from "../../runtime/daemon";

/**
 * The argv shaping a detached child inherits.
 *
 * This covers the cases reachable without a process: which argv[1] is passed
 * on, and what `--detach` stripping does and does not touch. It deliberately
 * does **not** claim the compiled-binary case — from source, Bun's virtual
 * entry path is simply absent from the filesystem, so the check that shipped
 * broken and the one that replaced it agree here and a test asserting on that
 * path would pass either way. `compiled-detach.test.ts` is what pins it.
 */
describe("Daemon.relaunchArgs", () => {
  const bun = "/usr/local/bin/bun";
  const binary = "/usr/local/bin/silo";
  // A file and a directory that exist on whatever machine this runs on.
  const realScript = import.meta.path;
  const realDir = os.tmpdir();

  test("forwards the entry script when running from source", () => {
    const argv = [bun, realScript, "serve", "--listen", ":8090"];
    expect(Daemon.relaunchArgs(argv, bun)).toEqual([realScript, "serve", "--listen", ":8090"]);
  });

  test("strips --detach and -d, and leaves values that merely look like them", () => {
    expect(Daemon.relaunchArgs([bun, realScript, "serve", "--detach"], bun)) //
      .toEqual([realScript, "serve"]);
    expect(Daemon.relaunchArgs([bun, realScript, "serve", "-d"], bun)) //
      .toEqual([realScript, "serve"]);
    expect(Daemon.relaunchArgs([bun, realScript, "serve", "--log-file", "-d.log"], bun)) //
      .toEqual([realScript, "serve", "--log-file", "-d.log"]);
  });

  /**
   * Three ways argv[1] can fail to be an entry script to hand on. The last two
   * are the ones `existsSync` got wrong in kind: it accepts a directory, and it
   * accepted Bun's virtual path for the same reason — being satisfied by
   * something other than a real file.
   */
  test("forwards nothing it cannot resolve to a real file", () => {
    const missing = path.join(realDir, "silo-no-such-entry-9f3a1c.ts");
    expect(fs.existsSync(missing)).toBe(false);

    expect(Daemon.relaunchArgs([binary, binary, "status"], binary)).toEqual(["status"]);
    expect(Daemon.relaunchArgs([bun, missing, "status"], binary)).toEqual(["status"]);
    expect(Daemon.relaunchArgs([bun, realDir, "status"], binary)).toEqual(["status"]);
  });

  test("survives an argv with nothing after the runtime", () => {
    expect(Daemon.relaunchArgs([bun], bun)).toEqual([]);
  });
});
