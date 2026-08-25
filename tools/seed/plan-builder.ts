import { CollectionCatalog } from "./collection-catalog";
import { Rng } from "./rng";
import type { ScopePlan } from "./scope-plan";
import type { SeedOptions } from "./seed-options";
import { Seeds } from "./seeds";

/**
 * Works out the whole shape of the corpus before a single request is sent, so
 * `--dry-run` can show exactly what a real run would write. Each scope draws
 * from its own RNG stream rather than a shared one: a scope's contents then
 * depend on its name and the seed, and not on the order scopes happen to be
 * visited in.
 */
export class PlanBuilder {
  private static readonly ProjectNames = [
    "acme", "northwind", "globex", "initech", "umbrella", "hooli", "soylent", "vandelay",
  ] as const;

  static build(options: SeedOptions): ScopePlan[] {
    const plan: ScopePlan[] = [];
    for (const project of PlanBuilder.projects(options.projects)) {
      for (const env of options.envs) {
        const rng = new Rng(Seeds.of(options.seed, `${project}/${env}`));
        const wanted = Math.min(
          rng.int(options.collections.min, options.collections.max),
          CollectionCatalog.count(),
        );
        plan.push({
          project,
          env,
          collections: CollectionCatalog.sample(rng, wanted).map((blueprint) => ({
            blueprint,
            entries: rng.int(options.entries.min, options.entries.max),
          })),
        });
      }
    }
    return plan;
  }

  private static projects(count: number): string[] {
    return Array.from({ length: count }, (_, i) => PlanBuilder.ProjectNames[i] ?? `project-${i + 1}`);
  }

  static totals(plan: ScopePlan[]): { projects: number; envs: number; collections: number; entries: number } {
    const projects = new Set(plan.map((s) => s.project));
    let collections = 0;
    let entries = 0;
    for (const scope of plan) {
      collections += scope.collections.length;
      for (const col of scope.collections) entries += col.entries;
    }
    return { projects: projects.size, envs: plan.length, collections, entries };
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
