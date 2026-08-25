import { Claims } from "@silo/shared/claims";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import { Scope } from "../../core/domain/scope";
import { EntryUtils } from "../../core/domain/entry-utils";
import type { WriteContext } from "../../core/hooks";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import type { PluginRpc } from "../host";

/**
 * What a plugin may do, and the only way it may do it (D31/§13.6).
 *
 * A plugin never receives `Storage` or `SiloService`. It calls these methods, and
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
 *
 * It holds **no per-dispatch state** (D33). It used to hold a `depth`, which
 * forced a runtime to serialise its own dispatches so that one number could
 * describe them — and that lock deadlocked every hook that wrote through here.
 */
export class PluginContext implements PluginRpc {
  private readonly name: string;
  private readonly claims: readonly string[];
  private readonly service: SiloService;
  private readonly logger: Logger;
  private readonly maxDepth: number;

  constructor(
    name: string,
    claims: readonly string[],
    service: SiloService,
    logger: Logger,
    maxDepth: number
  ) {
    this.name = name;
    this.claims = claims;
    this.service = service;
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

  /**
   * Serve one callback.
   *
   * `cause` is the causal chain of the dispatch this call came out of, handed
   * back by the host rather than remembered here: a context serves callbacks
   * from every in-flight dispatch of its plugin at once, so a field could not
   * say which one any given call belongs to (D33).
   */
  async call(
    method: string,
    args: readonly unknown[],
    cause: readonly string[]
  ): Promise<unknown> {
    switch (method) {
      case "entries.get":
        return await this.get(args);
      case "entries.list":
        return await this.list(args);
      case "entries.create":
        return await this.create(args, cause);
      case "entries.update":
        return await this.update(args, cause);
      case "entries.delete":
        return await this.remove(args, cause);
      default:
        throw new Error(`plugin "${this.name}": unknown context method "${method}"`);
    }
  }

  private async get(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:read");
    const entry = await this.service.entries.get(scope, collection, this.id(args[2]));
    return EntryUtils.toApiResponse(entry);
  }

  private async list(args: readonly unknown[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:read");
    const response = await this.service.entries.list(scope, collection, (args[3] ?? {}) as any);
    return {
      items: response.items.map((e) => EntryUtils.toApiResponse(e)),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
    };
  }

  private async create(args: readonly unknown[], cause: readonly string[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:create");
    const entry = await this.service.entries.create(scope, collection, args[2], this.write(cause));
    return EntryUtils.toApiResponse(entry);
  }

  private async update(args: readonly unknown[], cause: readonly string[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:update");
    const entry = await this.service.entries.update(
      scope,
      collection,
      this.id(args[2]),
      args[3],
      this.rev(args[4]),
      this.write(cause)
    );
    return EntryUtils.toApiResponse(entry);
  }

  private async remove(args: readonly unknown[], cause: readonly string[]): Promise<unknown> {
    const { scope, collection } = this.target(args, "entries:delete");
    await this.service.entries.delete(
      scope,
      collection,
      this.id(args[2]),
      this.rev(args[3]),
      this.write(cause)
    );
    return null;
  }

  /**
   * The write context a plugin-originated write carries: this plugin appended
   * to the chain that caused it (D33).
   *
   * The chain is what stops a cycle — `HookBus` will not dispatch back into a
   * plugin already named in it — so this bound is only a cap on how many
   * *distinct* plugins may chain off one request. Refused rather than
   * truncated: a silently un-run hook is the failure this whole design exists
   * to avoid, so a runaway fan-out is broken with an error naming the chain
   * instead of by quietly not dispatching.
   */
  private write(cause: readonly string[]): WriteContext {
    const chain = [...cause, this.name];
    if (chain.length > this.maxDepth) {
      throw new ForbiddenError(
        `plugin "${this.name}": write refused at hook depth ${chain.length} ` +
          `(limit ${this.maxDepth}) — the chain was ${chain.join(" -> ")}.`
      );
    }
    return { origin: `plugin:${this.name}`, chain };
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
