import { PlanBuilder } from "./plan-builder";
import type { CollectionPlan, ScopePlan } from "./scope-plan";
import type { SeedOptions } from "./seed-options";

export class Reporter {
  private started = 0;

  static number(n: number): string {
    return n.toLocaleString("en-US");
  }

  static duration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  header(options: SeedOptions, plan: ScopePlan[]): void {
    const t = PlanBuilder.totals(plan);
    console.log(`\nsilo seeder → ${options.url}`);
    console.log(
      `plan: ${t.projects} project(s) × ${options.envs.length} env(s) — ` +
        `${options.collections.min}–${options.collections.max} collections each, ` +
        `${options.entries.min}–${options.entries.max} entries each`,
    );
    console.log(`reproduce: --seed ${options.seed} --epoch ${options.epoch}`);
    console.log(
      `total: ${Reporter.number(t.collections)} collections, ${Reporter.number(t.entries)} entries\n`,
    );
    for (const scope of plan) {
      const entries = scope.collections.reduce((sum, c) => sum + c.entries, 0);
      console.log(
        `  ${`${scope.project}/${scope.env}`.padEnd(24)}` +
          `${String(scope.collections.length).padStart(3)} collections` +
          `${Reporter.number(entries).padStart(8)} entries`,
      );
    }
    console.log("");
  }

  begin(): void {
    this.started = performance.now();
  }

  collection(scope: ScopePlan, plan: CollectionPlan, done: number, total: number): void {
    const pct = Math.round((done / total) * 100);
    console.log(
      `  [${String(pct).padStart(3)}%] ${`${scope.project}/${scope.env}`.padEnd(24)}` +
        `${plan.blueprint.name.padEnd(16)}${Reporter.number(plan.entries).padStart(6)} entries`,
    );
  }

  done(plan: ScopePlan[]): void {
    const t = PlanBuilder.totals(plan);
    const elapsed = performance.now() - this.started;
    const rate = t.entries / Math.max(elapsed / 1000, 0.001);
    console.log(
      `\ndone: ${t.projects} projects, ${t.envs} environments, ` +
        `${Reporter.number(t.collections)} collections, ${Reporter.number(t.entries)} entries ` +
        `in ${Reporter.duration(elapsed)} (${Math.round(rate)} entries/s)\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
