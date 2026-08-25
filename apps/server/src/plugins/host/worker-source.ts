/**
 * The bootstrap that runs inside every extension plugin's `Worker` (D31/§13.4).
 *
 * It is a **string**, not a module in this tree, and it imports nothing from
 * silo. That is forced by how silo ships: `bun build --compile` bundles the
 * host's import graph, and a `Worker` entry loaded from outside that graph
 * cannot resolve `../core/...`. Verified against a compiled binary rather than
 * assumed — a `data:` URL worker starts, and `Bun.plugin()` module registration
 * works inside the worker realm, which is what makes `silo:api` resolvable
 * there at all.
 *
 * It therefore speaks only plain JSON over `postMessage`, which is the same
 * discipline §13.4 wants for the payloads anyway.
 *
 * No template literals below: this whole file is one, and a stray `${` inside
 * would interpolate at the wrong level.
 */
export class WorkerSource {
  static readonly Code = [
    'import { plugin } from "bun";',
    "",
    "// Errors a plugin throws to *reject* rather than to fault. Locally defined",
    "// because a class cannot cross a structured-clone boundary; the host maps",
    "// them back by `name`, which is the same reason ValidationError.is exists",
    "// on the host side.",
    "class SiloValidationError extends Error {",
    "  constructor(message, details) {",
    '    super(message); this.name = "ValidationError"; this.details = details;',
    "  }",
    "}",
    "class SiloForbiddenError extends Error {",
    '  constructor(message) { super(message); this.name = "ForbiddenError"; }',
    "}",
    "",
    'plugin({ name: "silo-api", setup(build) {',
    '  build.module("silo:api", () => ({',
    "    exports: {",
    "      defineSiloPlugin: (definition) => definition,",
    "      ValidationError: SiloValidationError,",
    "      ForbiddenError: SiloForbiddenError,",
    "    },",
    '    loader: "object",',
    "  }));",
    "}});",
    "",
    "let mod = null;",
    "let config = null;",
    "let rpcSeq = 0;",
    "const pending = new Map();",
    "",
    "// `dispatch` is the id of the hook dispatch this call is being made from,",
    "// so the host can tell which dispatch's causal chain the call belongs to.",
    "// The host reads the chain from its own record of that dispatch, never from",
    "// this message — see WorkerHost.serveRpc.",
    "const rpc = (method, args, dispatch) => new Promise((resolve, reject) => {",
    "  const id = ++rpcSeq;",
    "  pending.set(id, { resolve, reject });",
    '  self.postMessage({ t: "rpc", id, method, args, dispatch });',
    "});",
    "",
    "const revive = (e) => {",
    '  if (!e) return new Error("plugin call failed");',
    '  if (e.name === "ValidationError") return new SiloValidationError(e.message, e.details);',
    '  if (e.name === "ForbiddenError") return new SiloForbiddenError(e.message);',
    "  const err = new Error(e.message); err.name = e.name || err.name; return err;",
    "};",
    "",
    "const wire = (e) => {",
    '  const w = { name: (e && e.name) || "Error", message: (e && e.message) || String(e) };',
    "  // Only when there is one. An explicitly-undefined property is not worth",
    "  // handing to structuredClone, and omitting it keeps the wire shape to",
    "  // exactly the keys that carry meaning.",
    "  if (e && e.details) w.details = e.details;",
    "  return w;",
    "};",
    "",
    "// Built per dispatch rather than once, so every ctx call carries the id of",
    "// the dispatch it came out of. One shared ctx could not say that, which is",
    "// why the host used to serialise dispatches to keep a single depth field",
    "// honest — and why a ctx write from a hook deadlocked.",
    "const buildCtx = (config, dispatch) => ({",
    "  config,",
    "  log: {",
    '    debug: (m, f) => self.postMessage({ t: "log", level: "debug", message: m, fields: f }),',
    '    info:  (m, f) => self.postMessage({ t: "log", level: "info",  message: m, fields: f }),',
    '    warn:  (m, f) => self.postMessage({ t: "log", level: "warn",  message: m, fields: f }),',
    '    error: (m, f) => self.postMessage({ t: "log", level: "error", message: m, fields: f }),',
    "  },",
    "  entries: {",
    '    get:    (scope, collection, id) => rpc("entries.get", [scope, collection, id], dispatch),',
    '    list:   (scope, collection, query) => rpc("entries.list", [scope, collection, query || {}], dispatch),',
    '    create: (scope, collection, data) => rpc("entries.create", [scope, collection, data], dispatch),',
    '    update: (scope, collection, id, data, rev) => rpc("entries.update", [scope, collection, id, data, rev], dispatch),',
    '    delete: (scope, collection, id, rev) => rpc("entries.delete", [scope, collection, id, rev], dispatch),',
    "  },",
    "});",
    "",
    "self.onmessage = async (event) => {",
    "  const msg = event.data;",
    "",
    '  if (msg.t === "init") {',
    "    try {",
    "      mod = await import(Bun.pathToFileURL(msg.entry).href);",
    "      const definition = mod.default;",
    '      if (!definition || typeof definition !== "object") {',
    '        throw new Error("the default export is not a plugin definition");',
    "      }",
    "      config = msg.config;",
    "      const exported = msg.declared.filter((h) => typeof definition[h] === \"function\");",
    '      self.postMessage({ t: "ready", hooks: exported });',
    "    } catch (caught) {",
    '      self.postMessage({ t: "init-error", error: wire(caught) });',
    "    }",
    "    return;",
    "  }",
    "",
    '  if (msg.t === "rpc-result") {',
    "    const waiter = pending.get(msg.id);",
    "    if (!waiter) return;",
    "    pending.delete(msg.id);",
    "    if (msg.ok) waiter.resolve(msg.value); else waiter.reject(revive(msg.error));",
    "    return;",
    "  }",
    "",
    '  if (msg.t === "dispatch") {',
    "    try {",
    "      const fn = mod.default[msg.hook];",
    "      const value = await fn.call(mod.default, msg.event, buildCtx(config, msg.id));",
    '      self.postMessage({ t: "result", id: msg.id, ok: true, value: value === undefined ? null : value });',
    "    } catch (caught) {",
    '      self.postMessage({ t: "result", id: msg.id, ok: false, error: wire(caught) });',
    "    }",
    "  }",
    "};",
    "",
    'self.postMessage({ t: "booted" });',
  ].join("\n");

  /**
   * The bootstrap as a `data:` URL.
   *
   * A URL rather than a file because `import.meta.dir` inside a compiled binary
   * points at the read-only embedded filesystem, and writing a bootstrap into
   * the data directory would put a scratch file in the one place D5 promises is
   * just the user's content. `blob:` works identically; `data:` needs no
   * lifetime management.
   */
  static url(): string {
    return "data:text/javascript;base64," + Buffer.from(WorkerSource.Code, "utf8").toString("base64");
  }
}
