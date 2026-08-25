import { parseArgs } from "node:util";
import type { Range, SeedOptions } from "./seed-options";

export class OptionsParser {
  private static readonly Usage = `silo data seeder — fill an instance with a large, realistic corpus

Usage:
  bun run tools/seed/main.ts [flags]

Flags:
  --url u            base URL of the silo server (default $SILO_URL or http://localhost:8090)
  --key k            API key (default $SILO_KEY); needs create claims on every scope it writes
  --projects n       how many projects to seed (default 2)
  --envs a,b,c       environments per project (default dev,uat,prod)
  --collections a-b  collections per environment (default 5-20)
  --entries a-b      entries per collection (default 20-100)
  --seed n           PRNG seed (default 1)
  --epoch t          instant the generated dates are measured from, ISO or ms
                     (default: now — pass the epoch a run prints to reproduce it)
  --concurrency n    entry writes in flight (default 8)
  --dry-run          print the plan and write nothing
  --yes              required to write to a non-localhost URL
  --help

The same --seed and --epoch produce the same entries; the order they are
written in still depends on --concurrency, so ids and silo's own timestamps are
assigned in whatever order the writes land.

Writes are additive — projects, environments and schemas are upserts, and
entries are appended. Nothing is ever deleted.`;

  static parse(argv: string[]): SeedOptions | null {
    const { values } = parseArgs({
      args: argv,
      options: {
        url: { type: "string" },
        key: { type: "string" },
        projects: { type: "string" },
        envs: { type: "string" },
        collections: { type: "string" },
        entries: { type: "string" },
        seed: { type: "string" },
        epoch: { type: "string" },
        concurrency: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });

    if (values.help) {
      console.log(OptionsParser.Usage);
      return null;
    }

    return {
      url: (values.url ?? process.env.SILO_URL ?? "http://localhost:8090").replace(/\/+$/, ""),
      key: values.key ?? process.env.SILO_KEY ?? "",
      projects: OptionsParser.count(values.projects, "projects", 2, 1, 64),
      envs: OptionsParser.envs(values.envs),
      collections: OptionsParser.range(values.collections, "collections", { min: 5, max: 20 }),
      entries: OptionsParser.range(values.entries, "entries", { min: 20, max: 100 }),
      seed: OptionsParser.count(values.seed, "seed", 1, 0, 2 ** 31),
      epoch: OptionsParser.epoch(values.epoch),
      concurrency: OptionsParser.count(values.concurrency, "concurrency", 8, 1, 64),
      dryRun: values["dry-run"] === true,
      confirmed: values.yes === true,
    };
  }

  private static count(raw: string | undefined, flag: string, fallback: number, min: number, max: number): number {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`--${flag} must be an integer between ${min} and ${max}, got "${raw}"`);
    }
    return n;
  }

  /** An ISO instant or epoch milliseconds; absent means now. */
  private static epoch(raw: string | undefined): number {
    if (raw === undefined) return Date.now();
    const ms = /^\d+$/.test(raw.trim()) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(ms)) throw new Error(`--epoch must be an ISO instant or epoch milliseconds, got "${raw}"`);
    return ms;
  }

  private static range(raw: string | undefined, flag: string, fallback: Range): Range {
    if (raw === undefined) return fallback;
    const match = /^(\d+)(?:-(\d+))?$/.exec(raw.trim());
    if (!match) throw new Error(`--${flag} must look like "20-100" or "50", got "${raw}"`);
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : Number(match[2]);
    if (max < min) throw new Error(`--${flag} range is inverted: "${raw}"`);
    return { min, max };
  }

  /** Ids the server would reject are caught here, not 40 requests into a run. */
  private static envs(raw: string | undefined): string[] {
    const ids = (raw ?? "dev,uat,prod").split(",").map((e) => e.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error("--envs needs at least one environment id");
    for (const id of ids) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
        throw new Error(`invalid env id "${id}": want lowercase letter first, then [a-z0-9_-], max 64 chars`);
      }
    }
    return ids;
  }
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
