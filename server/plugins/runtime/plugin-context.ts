import { Claims } from "@silo/shared/claims";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import { Scope } from "../../core/domain/scope";
import { EntryUtils } from "../../core/domain/entry-utils";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { ValidationError } from "@silo/shared/validation-error";
import type { Service } from "../../core/service/service";
import type { Logger } from "../../logging/logger";
import type { PluginRpc } from "../host";

/**
 * What a plugin may do, and the only way it may do it (D31/§13.6).
 *
 * A plugin never receives `Storage` or `Service`. It calls these methods, and
 * every one of them is checked against the claims the operator granted, using
 * the same `Claims` machinery a request goes through — **a plugin is an API key
 * with code attached.** It cannot widen its own reach, and what it did is
 * describable in exactly the vocabulary a key's actions are.
 *
 * The check is a guard-rail, not a sandbox. In-process or in a worker, plugin
 * code holds full Bun privileges and could reach the database directly; what
 * this stops is a plugin *quietly* doing more than its manifest said, which is
 * the failure that actually happens. Containment is §13.4's business, and its
 * honest limit is stated there.
 */
export class PluginContext implements PluginRpc {
  /**
   * How many plugin-originated writes deep the dispatch currently being served
   * is. Set by `PluginRuntime` around each dispatch, which is sound because a
   * runtime serialises its own dispatches — without that, one field could not
   * describe two interleaved ones.
   */
  depth = 0;

  private readonly name: string;
  private readonly claims: readonly string[];
  private readonly svc: Service;
  private readonly logger: Logger;
  private readonly maxDepth: number;

  constructor(
    name: string,
    claims: readonly string[],
    svc: Service,
    logger: Logger,
    maxDepth: number
  ) {
    this.name = name;
    this.claims = claims;
    this.svc = svc;
    this.logger = logger;
    this.maxDepth = maxDepth;
  }

  log(level: string, message: string, fields?: Record<string, unknown>): void {
    // Namespaced, so a plugin's output cannot be mistaken for the server's in a
    // log someone is reading at 3am.
    const entry = { ...(fields ?? {}), plugin: this.name };
    switch (level) {
      case "debug":
        return this.logger.debug(message, entry);
      case "warn":
        return this.logger.warn(message, entry);
      case "error":
        return this.logger.error(message, entry);
      default:
        return this.logger.info(message, entry);
    }
  }

  async call(method: string, args: readonly unknown[]): Promise<unknown> {
    switch (method) {
      case "entries.get":
        return await this.get(args);
      case "entries.list":
        return await this.list(args);
      case "entries.create":
        return await this.create(args);
      case "entries.update":
        return await this.update(args);
      case "entries.delete":
        return await this.remove(args);
      default:
        throw new Error(`plugin "${this.name}": unknown context method "${method}"`);
    }
  }

  private async get(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:read");
    const entry = await this.svc.getEntry(scope, collection, this.id(args[2]));
    return EntryUtils.toApiResponse(entry);
  }

  private async list(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:read");
    const res = await this.svc.listEntries(scope, collection, (args[3] ?? {}) as any);
    return {
      items: res.items.map((e) => EntryUtils.toApiResponse(e)),
      total: res.total,
      limit: res.limit,
      offset: res.offset,
    };
  }

  private async create(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:create");
    const entry = await this.svc.createEntry(scope, collection, args[2], this.write());
    return EntryUtils.toApiResponse(entry);
  }

  private async update(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:update");
    const entry = await this.svc.updateEntry(
      scope,
      collection,
      this.id(args[2]),
      args[3],
      this.rev(args[4]),
      this.write()
    );
    return EntryUtils.toApiResponse(entry);
  }

  private async remove(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:delete");
    await this.svc.deleteEntry(scope, collection, this.id(args[2]), this.rev(args[3]), this.write());
    return null;
  }

  /**
   * The write context a plugin-originated write carries.
   *
   * Refused rather than truncated past the limit: a silently un-run hook is the
   * failure this whole design exists to avoid, so the loop is broken with an
   * error naming the plugin instead of by quietly not dispatching.
   */
  private write(): { origin: `plugin:${string}`; depth: number } {
    const depth = this.depth + 1;
    if (depth > this.maxDepth) {
      throw new ForbiddenError(
        `plugin "${this.name}": write refused at hook depth ${depth} (limit ${this.maxDepth}) — ` +
          `a hook is writing in a loop.`
      );
    }
    return { origin: `plugin:${this.name}`, depth };
  }

  /** The scope and collection an argument list names, once the plugin has been
   *  shown to hold `permission` over it. */
  private target(
    args: readonly unknown[],
    permission: CollectionPermission
  ): { scope: Scope; collection: string } {
    const raw = args[0] as { project?: unknown; env?: unknown } | undefined;
    if (!raw || typeof raw !== "object") {
      throw new ValidationError(`plugin "${this.name}": first argument must be { project, env }`);
    }
    const scope = Scope.of(String(raw.project), String(raw.env));

    const collection = args[1];
    if (typeof collection !== "string" || !Claims.isCollectionName(collection)) {
      throw new ValidationError(`plugin "${this.name}": invalid collection ${JSON.stringify(collection)}`);
    }

    if (!Claims.has(this.claims, Claims.collection(scope.project, scope.env, collection, permission))) {
      throw new ForbiddenError(
        `plugin "${this.name}" does not hold ` +
          `${Claims.collection(scope.project, scope.env, collection, permission)}. ` +
          `Add it to the plugin's "claims" in silo.toml.`
      );
    }
    return { scope, collection };
  }

  private id(value: unknown): string {
    EntryUtils.assertSafeSegment(value, "id");
    return String(value);
  }

  private rev(value: unknown): number {
    const rev = Number(value);
    if (!Number.isInteger(rev) || rev < 1) {
      throw new ValidationError(`plugin "${this.name}": rev must be a positive integer`);
    }
    return rev;
  }
}
