#!/usr/bin/env bun
/**
 * A data seeder: fills a running silo instance with a large, realistic corpus
 * so the admin UI, search, filters and paging can be exercised at a size
 * hand-entry never reaches.
 *
 * It speaks the public HTTP API and nothing else — no imports from the server,
 * the shared package or the UI, and no dependencies beyond Bun's builtins. To
 * drop it on a machine that does not have this repo, bundle it first:
 *
 *   bun build tools/seed/main.ts --target=bun --outfile seed.js
 *
 * The corpus is a function of `--seed` and `--epoch` — the second because dates
 * have to be measured from somewhere, and reading the clock mid-generation is
 * what silently made two runs of one seed differ. `--epoch` defaults to now and
 * every run prints the pair that reproduces it.
 *
 * Writes are additive: it creates and never deletes. Re-running over an
 * instance re-uses the scopes and schemas it finds and appends a fresh
 * generation of entries.
 *
 *   bun run tools/seed/main.ts --key "$SILO_KEY"
 *   bun run tools/seed/main.ts --url http://localhost:8090 --projects 3 --seed 7
 *   bun run tools/seed/main.ts --key "$SILO_KEY" --dry-run
 */
import { OptionsParser } from "./options-parser";
import { PlanBuilder } from "./plan-builder";
import { Reporter } from "./reporter";
import type { SeedOptions } from "./seed-options";
import { Seeder } from "./seeder";
import { SiloClient } from "./silo-client";

export class Main {
  static async run(): Promise<number> {
    let options: SeedOptions | null;
    try {
      options = OptionsParser.parse(Bun.argv.slice(2));
    } catch (caught) {
      console.error(`error: ${caught instanceof Error ? caught.message : caught}`);
      return 2;
    }
    if (!options) return 0;

    const plan = PlanBuilder.build(options);
    const reporter = new Reporter();
    reporter.header(options, plan);

    if (options.dryRun) {
      console.log("dry run — nothing was written.\n");
      return 0;
    }
    if (!Main.isLocal(options.url) && !options.confirmed) {
      console.error(
        `refusing to write ${Reporter.number(PlanBuilder.totals(plan).entries)} entries to a remote ` +
          `instance (${options.url}) without --yes.`,
      );
      return 2;
    }

    const seeder = new Seeder(new SiloClient(options.url, options.key), options, reporter);
    try {
      await seeder.preflight();
      await seeder.run(plan);
    } catch (caught) {
      console.error(`\nerror: ${caught instanceof Error ? caught.message : caught}`);
      return 1;
    }
    reporter.done(plan);
    return 0;
  }

  private static isLocal(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
      return false;
    }
  }
}

process.exit(await Main.run());
