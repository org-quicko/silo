/**
 * Types for the `silo:api` virtual module (D31/§13.3).
 *
 * `silo:api` has no file on disk — `SiloApi` registers it in the host realm and
 * `WorkerSource` registers a matching one inside each worker, so a plugin can
 * `import` it while depending on nothing at runtime. TypeScript still needs to
 * be told the specifier exists, and this is that.
 *
 * It is also the shape a published `@silo/plugin-types` would carry: **types
 * only, contributing nothing at runtime**. If it ever grows a value, the
 * dependency-free property that makes the virtual module worth having is gone.
 */
declare module "silo:api" {
  /** `{ project, env }` — the scope a hook event belongs to, and what
   *  `ctx.entries.*` takes. */
  export interface SiloScope {
    project: string;
    env: string;
  }

  export interface SiloHookEvent {
    op: "create" | "update" | "delete";
    /** `api` for a request, or `plugin:<name>` for a write another plugin
     *  made. Informational: silo does not deliver an event to a plugin already
     *  in the chain that caused it, so you never see your own writes and two
     *  plugins cannot ping-pong. (`import` is reserved but never raised: the
     *  transfer paths do not dispatch hooks.) */
    origin: string;
    scope: SiloScope;
    collection: string;
    depth: number;
    id?: string;
    rev?: number;
    data?: any;
    created_at?: string;
    updated_at?: string;
  }

  /** What a plugin may do. Every call is checked against the claims the
   *  operator granted (§13.6). */
  export interface SiloContext {
    /** `[plugins.config]`, already validated against the manifest's schema. */
    config: Record<string, any>;
    log: {
      debug(message: string, fields?: Record<string, unknown>): void;
      info(message: string, fields?: Record<string, unknown>): void;
      warn(message: string, fields?: Record<string, unknown>): void;
      error(message: string, fields?: Record<string, unknown>): void;
    };
    entries: {
      get(scope: SiloScope, collection: string, id: string): Promise<any>;
      list(scope: SiloScope, collection: string, query?: any): Promise<{
        items: any[];
        total: number;
        limit: number;
        offset: number;
      }>;
      create(scope: SiloScope, collection: string, data: any): Promise<any>;
      update(
        scope: SiloScope,
        collection: string,
        id: string,
        data: any,
        rev: number
      ): Promise<any>;
      delete(scope: SiloScope, collection: string, id: string, rev: number): Promise<void>;
    };
  }

  /**
   * The hooks a plugin may implement. Only those its manifest **declares** are
   * dispatched, so adding a function here without adding it to `silo.hooks` in
   * `package.json` does nothing.
   */
  export interface SiloPluginDefinition {
    /** Return `{ data }` to replace the value, or nothing to leave it. */
    "entry.beforeValidate"?(
      event: SiloHookEvent,
      ctx: SiloContext
    ): void | { data: any } | Promise<void | { data: any }>;
    /** Throw `ValidationError` or `ForbiddenError` to reject the write. */
    "entry.beforeWrite"?(event: SiloHookEvent, ctx: SiloContext): void | Promise<void>;
    "entry.afterWrite"?(event: SiloHookEvent, ctx: SiloContext): void | Promise<void>;
    "entry.beforeDelete"?(event: SiloHookEvent, ctx: SiloContext): void | Promise<void>;
    "entry.afterDelete"?(event: SiloHookEvent, ctx: SiloContext): void | Promise<void>;
  }

  /** Identity at runtime. It exists so a plugin's default export is typed, and
   *  so the shape has a name to search for. */
  export function defineSiloPlugin(definition: SiloPluginDefinition): SiloPluginDefinition;

  /**
   * Throw to **reject** an operation: it surfaces as a 400, exactly as a schema
   * failure would. An ordinary `Error` is a plugin *fault* instead, and what
   * happens to it is the operator's `on_error` (§13.9).
   */
  export class ValidationError extends Error {
    constructor(message: string, details?: { path: string; message: string }[]);
  }

  /** Throw to reject with a 403. */
  export class ForbiddenError extends Error {
    constructor(message?: string);
  }

  /** The running silo's version, as `package.json` declares it (D28). */
  export const SiloVersion: string;
}
