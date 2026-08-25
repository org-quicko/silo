import { ApiError } from "./api-error";
import type { CollectionBlueprint } from "./collection-blueprint";
import { Reporter } from "./reporter";
import { Rng } from "./rng";
import { SchemaFactory } from "./schema-factory";
import type { CollectionPlan, ScopePlan } from "./scope-plan";
import type { SeedOptions } from "./seed-options";
import { Seeds } from "./seeds";
import { SiloClient } from "./silo-client";
import { TaskPool } from "./task-pool";
import { ValueFactory } from "./value-factory";

/** Walks the plan and writes it, scope by scope and collection by collection. */
export class Seeder {
  private readonly seenProjects = new Set<string>();

  constructor(
    private readonly client: SiloClient,
    private readonly options: SeedOptions,
    private readonly reporter: Reporter,
  ) {}

  /**
   * Fails fast on the first preflight problem rather than on request 300 of a
   * long run: an unreachable server and a rejected key both look like "nothing
   * happened" once thousands of writes are already in flight.
   */
  async preflight(): Promise<void> {
    const health = await this.client
      .get<{ status: string; version: string }>("/api/health")
      .catch((err) => {
        throw new Error(`cannot reach ${this.options.url}: ${err instanceof Error ? err.message : err}\n` +
          `start one with: bun run apps/server/src/main.ts serve`);
      });

    let session: { label: string; claims: string[] };
    try {
      session = await this.client.get<{ label: string; claims: string[] }>("/api/session");
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        throw new Error(
          this.options.key
            ? "the API key was rejected — check --key / $SILO_KEY"
            : "no API key given: pass --key or set $SILO_KEY\n" +
              "mint one with: bun run apps/server/src/main.ts keys create --preset root --label seeder",
        );
      }
      throw caught;
    }

    console.log(
      `server ${health.version}, key "${session.label}" ` +
        `(${session.claims.length} claim${session.claims.length === 1 ? "" : "s"})`,
    );
  }

  async run(plan: ScopePlan[]): Promise<void> {
    const total = plan.reduce((sum, scope) => sum + scope.collections.length, 0);
    let done = 0;

    this.reporter.begin();
    for (const scope of plan) {
      await this.ensureProject(scope.project);
      await this.ensureEnvironment(scope.project, scope.env);
      for (const collection of scope.collections) {
        await this.ensureCollection(scope, collection.blueprint);
        await this.fill(scope, collection);
        this.reporter.collection(scope, collection, ++done, total);
      }
    }
  }

  private async ensureProject(project: string): Promise<void> {
    if (this.seenProjects.has(project)) return;
    await this.client.post("/api/projects", { id: project });
    this.seenProjects.add(project);
  }

  private async ensureEnvironment(project: string, env: string): Promise<void> {
    await this.client.post(`/api/projects/${project}/envs`, { id: env });
  }

  private async ensureCollection(scope: ScopePlan, blueprint: CollectionBlueprint): Promise<void> {
    await this.client.post(`/api/projects/${scope.project}/envs/${scope.env}/collections`, {
      name: blueprint.name,
      schema: SchemaFactory.build(blueprint),
    });
  }

  /**
   * Payloads are generated up front, in order, from one collection-scoped RNG;
   * only the writes are concurrent. Generating inside the workers would make
   * the corpus depend on how the lanes interleaved, and `--seed` would stop
   * meaning anything.
   */
  private async fill(scope: ScopePlan, plan: CollectionPlan): Promise<void> {
    const rng = new Rng(Seeds.of(this.options.seed, `${scope.project}/${scope.env}/${plan.blueprint.name}`));
    const factory = new ValueFactory(rng, this.options.epoch);
    const payloads = Array.from({ length: plan.entries }, () => factory.entry(plan.blueprint.fields));

    const path = `/api/projects/${scope.project}/envs/${scope.env}/collections/${plan.blueprint.name}`;
    await TaskPool.run(payloads, this.options.concurrency, async (payload) => {
      await this.client.post(path, payload);
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
