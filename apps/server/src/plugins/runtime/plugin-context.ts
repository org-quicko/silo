import type { WriteContext } from "../../core/hooks";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import type { InjectedPrincipal } from "../../http/auth/injected-principal";
import type { Logger } from "../../logging/logger";
import type { PluginCallContext } from "../host/plugin-call-context";
import type { PluginFetchRequest } from "../host/plugin-fetch-request";
import type { PluginRpc } from "../host";
import type { PluginApiDispatcher } from "./plugin-api-dispatcher";

/** Everything a context needs to stand in for one plugin. An options object
 *  rather than six positional arguments, three of which are strings. */
export interface PluginContextOptions {
  name: string;
  /** The plugin's effective authority: `silo.toml` union the `_plugins` grant
   *  (D34), which is what the injected principal presents. */
  claims: readonly string[];
  /** The managed `_keys` record, or `""` while the plugin is pending. */
  keyId: string;
  dispatcher: PluginApiDispatcher;
  logger: Logger;
  maxDepth: number;
}

/**
 * What a plugin may do, and the only way it may do it (D31/§13.6, D35).
 *
 * Since D35 this holds **one** callable method. It used to hold five, each with
 * a hand-rolled claim check, and that shape had two problems that grew together:
 * every route added since was invisible to plugins, and every guard it restated
 * — `requirePublicOrClaim`, the transfer permission lists, the media disclosure
 * rule — was a second evaluator free to disagree with `RouteAuth`. Widening it
 * to forty methods would have made both worse.
 *
 * So the claim check is **deleted, not extended.** A call becomes a request
 * against the same Hono app a network request hits, carrying an injected
 * principal built from the grant, and `AuthMiddleware` and `RouteAuth` decide
 * exactly as they do for a key — because a plugin **is** an API key with code
 * attached, and now that sentence is an implementation rather than an analogy.
 *
 * It holds **no per-dispatch state** (D33). It used to hold a `depth`, which
 * forced a runtime to serialise its own dispatches so that one number could
 * describe them — and that lock deadlocked every hook that wrote through here.
 */
export class PluginContext implements PluginRpc {
  private readonly name: string;
  private readonly claims: readonly string[];
  private readonly keyId: string;
  private readonly dispatcher: PluginApiDispatcher;
  private readonly logger: Logger;
  private readonly maxDepth: number;

  constructor(options: PluginContextOptions) {
    this.name = options.name;
    this.claims = options.claims;
    this.keyId = options.keyId;
    this.dispatcher = options.dispatcher;
    this.logger = options.logger;
    this.maxDepth = options.maxDepth;
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
   * `dispatch` describes the hook dispatch this call came out of, handed back
   * by the host rather than remembered here: a context serves callbacks from
   * every in-flight dispatch of its plugin at once, so a field could not say
   * which one any given call belongs to (D33).
   */
  async call(
    method: string,
    args: readonly unknown[],
    dispatch: PluginCallContext
  ): Promise<unknown> {
    if (method !== "fetch") {
      throw new Error(`plugin "${this.name}": unknown context method "${method}"`);
    }
    return await this.fetch(args[0], dispatch);
  }

  private async fetch(raw: unknown, dispatch: PluginCallContext): Promise<unknown> {
    const request = raw as PluginFetchRequest | undefined;
    if (!request || typeof request !== "object" || typeof request.path !== "string") {
      throw new ForbiddenError(`plugin "${this.name}": ctx.fetch needs a request with a path.`);
    }

    return await this.dispatcher.dispatch(
      this.name,
      request,
      this.principal(dispatch.cause),
      dispatch.budgetMs
    );
  }

  /**
   * The caller this plugin's requests arrive as.
   *
   * Its claims are the **resolved** authority rather than the managed key's own
   * `granted` list, because an operator may grant through `silo.toml` as well as
   * through the record (D34) and the union is what every check before D35 used.
   * The key record is the revocable handle and the name in an audit trail; the
   * grant is the authority.
   *
   * No secret and no hash, because there is nothing to authenticate: the host
   * attaches this beside the request rather than presenting it, which is why a
   * worker never receives its own secret and cannot present a different one.
   */
  private principal(cause: readonly string[]): InjectedPrincipal {
    return {
      key: {
        id: this.keyId,
        label: `plugin:${this.name}`,
        claims: [...this.claims],
        hash: "",
        prefix: "",
        owner: { kind: "plugin", name: this.name },
      },
      write: this.write(cause),
    };
  }

  /**
   * The write context a plugin-originated request carries: this plugin appended
   * to the chain that caused it (D33).
   *
   * It rides the injected principal because it has to survive the hop — before
   * D35 the chain lived in this class and was handed straight to `EntryService`,
   * and phase 3 replaced that path with an HTTP request. A write route reads it
   * back through `RouteAuth.getWriteContext`, so a plugin's HTTP-shaped write
   * still refuses to re-enter its own hooks.
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
}
