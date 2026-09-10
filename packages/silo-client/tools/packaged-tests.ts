/**
 * Consumes the package the way npm would, because testing `src/` cannot tell
 * you whether the published artifact resolves (plan D23, section 8).
 *
 * Packs the tarball, then installs it into throwaway consumers: Node ESM, Node
 * CommonJS, and Bun. `publint` and `attw` check the manifest and both
 * declaration conditions. A missing tool is reported as skipped, not as a
 * pass, and only a real failure sets the exit code.
 */

import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Outcome = "passed" | "failed" | "skipped";

interface Check {
  name: string;
  outcome: Outcome;
  detail: string;
}

class PackagedTests {
  private static readonly PackageRoot = join(import.meta.dir, "..");
  private static readonly Checks: Check[] = [];

  static async run(): Promise<number> {
    await PackagedTests.build();
    const tarball = await PackagedTests.pack();

    await PackagedTests.lintManifest();
    await PackagedTests.checkTypeConditions();
    await PackagedTests.consumeAsEsm(tarball);
    await PackagedTests.consumeAsCommonJs(tarball);
    await PackagedTests.consumeFromBun(tarball);

    PackagedTests.report();
    return PackagedTests.Checks.some((check) => check.outcome === "failed") ? 1 : 0;
  }

  private static async build(): Promise<void> {
    const built = await PackagedTests.spawn(["bun", "run", "build"], PackagedTests.PackageRoot);
    if (built.exitCode !== 0) {
      throw new Error(`build failed before packing:\n${built.output}`);
    }
    const emitted = await readdir(join(PackagedTests.PackageRoot, "dist"));
    for (const required of ["index.js", "index.cjs", "index.d.ts", "index.d.cts"]) {
      if (!emitted.includes(required)) {
        throw new Error(`build produced no dist/${required}; the exports map points at a file that is not there`);
      }
    }
  }

  /** The tarball npm would publish, in a temp directory. */
  private static async pack(): Promise<string> {
    const destination = await mkdtemp(join(tmpdir(), "silo-client-pack-"));
    const packed = await PackagedTests.spawn(
      ["npm", "pack", "--pack-destination", destination],
      PackagedTests.PackageRoot
    );
    if (packed.exitCode !== 0) {
      throw new Error(`npm pack failed:\n${packed.output}`);
    }
    const files = await readdir(destination);
    const tarball = files.find((file) => file.endsWith(".tgz"));
    if (!tarball) throw new Error(`npm pack wrote no tarball into ${destination}`);
    return join(destination, tarball);
  }

  private static async lintManifest(): Promise<void> {
    await PackagedTests.tool("publint", ["bunx", "--bun", "publint", "--strict"], PackagedTests.PackageRoot);
  }

  /** The check that catches one `.d.ts` serving both module conditions. */
  private static async checkTypeConditions(): Promise<void> {
    await PackagedTests.tool(
      "attw",
      ["bunx", "--bun", "@arethetypeswrong/cli", "--pack", "."],
      PackagedTests.PackageRoot
    );
  }

  private static async consumeAsEsm(tarball: string): Promise<void> {
    const source = [
      'import { Silo, Filter, Sort, ConflictError } from "silo-client";',
      "const silo = new Silo({ url: \"http://localhost:8090\" });",
      "if (typeof silo.project !== \"function\") throw new Error(\"no project handle\");",
      'if (Filter.field("status").equals("published").toJSON().op !== "eq") throw new Error("filter broken");',
      'if (!String(Sort.recentlyUpdated()).includes("updated_at")) throw new Error("sort broken");',
      'if (!(Object.create(ConflictError.prototype) instanceof Error)) throw new Error("error chain broken");',
      'console.log("esm ok");',
    ].join("\n");
    await PackagedTests.consume("node ESM", tarball, "consumer.mjs", source, ["node", "consumer.mjs"]);
  }

  private static async consumeAsCommonJs(tarball: string): Promise<void> {
    const source = [
      'const { Silo, Filter } = require("silo-client");',
      "const silo = new Silo({ url: \"http://localhost:8090\" });",
      "if (typeof silo.project !== \"function\") throw new Error(\"no project handle\");",
      'if (Filter.field("status").equals("published").toJSON().op !== "eq") throw new Error("filter broken");',
      'console.log("cjs ok");',
    ].join("\n");
    await PackagedTests.consume("node CommonJS", tarball, "consumer.cjs", source, ["node", "consumer.cjs"]);
  }

  private static async consumeFromBun(tarball: string): Promise<void> {
    const source = [
      'import { Silo } from "silo-client";',
      "const silo = new Silo({ url: \"http://localhost:8090\" });",
      "if (typeof silo.project !== \"function\") throw new Error(\"no project handle\");",
      'console.log("bun ok");',
    ].join("\n");
    await PackagedTests.consume("bun", tarball, "consumer.ts", source, ["bun", "consumer.ts"]);
  }

  /** Installs the tarball into a throwaway project and runs one script in it. */
  private static async consume(
    name: string,
    tarball: string,
    filename: string,
    source: string,
    command: string[]
  ): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "silo-client-consumer-"));
    try {
      await writeFile(join(directory, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
      await writeFile(join(directory, filename), source);

      const installed = await PackagedTests.spawn(["npm", "install", "--no-audit", "--no-fund", tarball], directory);
      if (installed.exitCode !== 0) {
        PackagedTests.record(name, "failed", `install failed: ${PackagedTests.lastLine(installed.output)}`);
        return;
      }

      const ran = await PackagedTests.spawn(command, directory);
      PackagedTests.record(
        name,
        ran.exitCode === 0 ? "passed" : "failed",
        PackagedTests.lastLine(ran.output)
      );
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * A check whose tool may not be installed: absent is skipped, not failed.
   *
   * A failure prints the tool's whole report rather than a summary line. Both
   * of these draw tables, so the last line of a failing run is a table border
   * and says nothing about what went wrong.
   */
  private static async tool(name: string, command: string[], cwd: string): Promise<void> {
    const ran = await PackagedTests.spawn(command, cwd);
    if (ran.exitCode === 0) {
      PackagedTests.record(name, "passed", "");
      return;
    }
    if (/not found|could not determine executable|ENOENT|404/i.test(ran.output)) {
      PackagedTests.record(name, "skipped", "not installed: run bun install at the repo root");
      return;
    }
    console.log(`\n--- ${name} reported ---\n${ran.output.trim()}\n`);
    PackagedTests.record(name, "failed", "see the report above");
  }

  private static async spawn(command: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
    const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    return { exitCode: await process.exited, output: `${stdout}${stderr}` };
  }

  private static record(name: string, outcome: Outcome, detail: string): void {
    PackagedTests.Checks.push({ name, outcome, detail });
  }

  private static lastLine(output: string): string {
    const lines = output.trim().split("\n").filter((line) => line.trim() !== "");
    return lines.length === 0 ? "" : lines[lines.length - 1]!.trim();
  }

  private static report(): void {
    const symbols: Record<Outcome, string> = { passed: "ok", failed: "FAIL", skipped: "skip" };
    for (const check of PackagedTests.Checks) {
      console.log(`${symbols[check.outcome].padEnd(5)} ${check.name.padEnd(16)} ${check.detail}`);
    }
  }
}

process.exit(await PackagedTests.run());
