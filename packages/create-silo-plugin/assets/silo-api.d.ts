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
 *
 * The `SiloContext` members between the `<generated…>` markers are emitted from
 * `PluginApiContract` (D35) — the same contract the worker's implementation is
 * built from, so a method cannot exist in one and not the other. Edit the
 * contract, not the markers; `plugin-api-contract.test.ts` fails on drift and
 * prints the block to paste.
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

  /**
   * What a collection-level hook sees (D36).
   *
   * Not a `SiloHookEvent`: there is no entry, so no `id`, `rev` or `data`, and the
   * one thing it does carry — how many entries went with the collection — has no
   * counterpart there.
   */
  export interface SiloCollectionEvent {
    op: "delete";
    origin: string;
    scope: SiloScope;
    collection: string;
    depth: number;
    /** How many entries the delete erased. `0` is ordinary: an empty collection
     *  still goes away. */
    erased: number;
    /** Which delete erased it. `environment` and `project` mean every sibling
     *  collection is going too. */
    cause: "collection" | "environment" | "project";
  }

  /** Query-string parameters, as the route reads them. An object value is sent
   *  as JSON, which is how `filter` and `sort` already travel. */
  export interface SiloQuery {
    limit?: number;
    offset?: number;
    [key: string]: any;
  }

  /** A page whose rows are under `data` — entries and search. */
  export interface SiloPage {
    data: any[];
    total: number;
    limit: number;
    offset: number;
    [key: string]: any;
  }

  /**
   * A page whose rows are under `items` — media, collections, projects.
   *
   * Two shapes because the HTTP API has two, and the client mirrors it rather
   * than smoothing it over: the same code has to work against a remote silo,
   * where the body is whatever the server sent.
   */
  export interface SiloItemPage {
    items: any[];
    total?: number;
    limit?: number;
    offset?: number;
  }

  /**
   * One answer from `ctx.fetch`.
   *
   * `text()` and `json()` are **synchronous**, unlike a real `Response`: the
   * bytes have already crossed the worker boundary, so there is nothing left to
   * await. `await response.json()` still reads fine and still works.
   */
  export interface SiloResponse {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    bytes: Uint8Array;
    text(): string;
    json(): any;
  }

  /**
   * What a plugin may do (§13.6).
   *
   * Every call is a request against silo's own HTTP API, authorized by the
   * claims the operator granted — the same routes, the same guards, and the
   * same answers a key with those claims would get.
   */
  export interface SiloContext {
    /** `[plugins.config]`, already validated against the manifest's schema. */
    config: Record<string, any>;
    log: {
      debug(message: string, fields?: Record<string, unknown>): void;
      info(message: string, fields?: Record<string, unknown>): void;
      warn(message: string, fields?: Record<string, unknown>): void;
      error(message: string, fields?: Record<string, unknown>): void;
    };

    /**
     * The whole API, for anything the typed methods below do not cover.
     *
     * Paths are absolute and must start with `/api/`. A refusal comes back as
     * a **status**, not a throw — `fetch` reports what happened, and it is the
     * typed methods that turn a 400 into a `ValidationError`. There is no
     * `Authorization` header to set: identity comes from the grant, and one set
     * here is dropped.
     */
    fetch(path: string, init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    }): Promise<SiloResponse>;

    // <generated from PluginApiContract>
    entries: {
      /** A page of entries. `limit`, `offset`, `filter` and `sort` are the query's keys. */
      list(scope: SiloScope, collection: string, query?: SiloQuery): Promise<SiloPage>;
      /** One entry, with media references expanded exactly as the API expands them. */
      get(scope: SiloScope, collection: string, id: string): Promise<any>;
      /** Create an entry. Validated against the collection's schema, like any write. */
      create(scope: SiloScope, collection: string, data: any): Promise<any>;
      /** Replace an entry. `rev` is required — a blind write is not offered. */
      update(scope: SiloScope, collection: string, id: string, data: any, rev: number): Promise<any>;
      /** Delete an entry. */
      delete(scope: SiloScope, collection: string, id: string, rev: number): Promise<void>;
      /** Full-text search within one collection. `q` is the query text. */
      search(scope: SiloScope, collection: string, query: SiloQuery): Promise<SiloPage>;
    };
    collections: {
      /** The collections of one scope that the grant can see. */
      list(scope: SiloScope): Promise<SiloItemPage>;
      /** One collection's JSON Schema, for a plugin that validates against it. */
      schema(scope: SiloScope, collection: string): Promise<any>;
    };
    projects: {
      /** The projects the grant can see, each with its environments. */
      list(): Promise<SiloItemPage>;
    };
    media: {
      /** A page of the media catalog. Media is instance-global, so this takes no scope. */
      list(query?: SiloQuery): Promise<SiloItemPage>;
      /** One media asset's metadata. The bytes are not reachable through `ctx`. */
      get(id: string): Promise<any>;
    };
    // </generated from PluginApiContract>
  }

  /** Who called a plugin route, or `null` on a `public` one reached with no
   *  credential. Never carries their secret — a plugin acts with its own
   *  authority, so there is nothing it could correctly do with theirs. */
  export interface SiloRequestCaller {
    id: string;
    label: string;
    claims: string[];
  }

  /** One request to a route the manifest declares (D36). */
  export interface SiloRequest {
    method: string;
    /** The **declared** path — `/notes/:id`. The values are in `params`. */
    path: string;
    params: Record<string, string>;
    query: Record<string, string>;
    /** Lowercased. `authorization`, `x-api-key` and `cookie` are withheld. */
    headers: Record<string, string>;
    /** Text, or `null`. Parse it yourself: only the route knows what it is. */
    body: string | null;
    caller: SiloRequestCaller | null;
  }

  /**
   * What a route handler may return.
   *
   * Nothing is a 204, a string is `text/plain`, any other object is a JSON body,
   * and this shape sets the status or the headers explicitly. `json` is a
   * convenience for `body: JSON.stringify(...)` with the content type.
   */
  export interface SiloRouteResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: string | null;
    json?: any;
  }

  /**
   * What a plugin implements: hooks and routes, on one object.
   *
   * Only what the manifest **declares** is ever called, so adding a function
   * here without adding it to `silo.hooks` or `silo.routes` in `package.json`
   * does nothing — and declaring one without implementing it refuses the start.
   *
   * A route is keyed exactly as the manifest declares it: `"GET /notes/:id"`.
   * The index signature is what lets those be written at all; it is deliberately
   * last, so the hooks above keep their precise types.
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
    /** One collection erased, entries and schema, after the delete committed.
     *  Observe only. There is no `before` counterpart — see the manifest docs. */
    "collection.afterDelete"?(
      event: SiloCollectionEvent,
      ctx: SiloContext
    ): void | Promise<void>;

    /**
     * Called once when the plugin becomes live, if the manifest declares
     * `contributes.runtime` (D36).
     *
     * This is where a plugin does something of its own accord — a timer, a warm
     * cache, a one-off migration — rather than only answering a hook or a route.
     * It runs before silo accepts its first request, and a throw here refuses the
     * start, so setup that must succeed belongs in it.
     *
     * It grants nothing: `ctx` is the same claim-checked surface a hook gets, and
     * a plugin awaiting approval is activated too — with every call refused,
     * exactly as its hooks are undelivered.
     */
    activate?(ctx: SiloContext): void | Promise<void>;

    /** Called once before the worker is torn down — a disable, a restart, a
     *  shutdown. Best-effort and bounded by `timeout_ms`: the decision to stop has
     *  already been taken, so nothing here can change it. */
    deactivate?(ctx: SiloContext): void | Promise<void>;

    /**
     * A route, named `"<METHOD> <path>"` as `silo.routes` declares it.
     *
     * Throw `ValidationError` or `ForbiddenError` to answer 400 or 403 — a
     * handler never names a status code to refuse.
     */
    [route: string]:
      | undefined
      | ((
          request: SiloRequest,
          ctx: SiloContext
        ) => void | any | SiloRouteResponse | Promise<void | any | SiloRouteResponse>)
      | SiloPluginDefinition["entry.beforeValidate"]
      | SiloPluginDefinition["entry.beforeWrite"]
      | SiloPluginDefinition["activate"];
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
