// Serves routes (D36, phase 6), one per thing a route can do or be refused.
//
// A route handler is a function on the same default export the hooks live on,
// named exactly as the manifest declares it — so the manifest is the index and
// `WorkerHost.reconcile` can refuse a declared route with no handler.
//
// Deliberately covers all four return shapes: an object is a JSON body, a
// string is text, `undefined` is a 204, and `{ status, ... }` sets one.
import { defineSiloPlugin, ValidationError } from "silo:api";

export default defineSiloPlugin({
  // Reached with no credential at all, which is what `auth: "public"` means and
  // why an operator approves it separately.
  "GET /hello"(request: any) {
    return { greeting: "hello", caller: request.caller, query: request.query };
  },

  // The caller is handed over so a plugin can be stricter than its route's
  // `auth` was; it never receives their credential.
  "GET /whoami"(request: any) {
    return { id: request.caller.id, claims: request.caller.claims, headers: request.headers };
  },

  // A path parameter, plus a `ctx` read — the plugin's own authority, not the
  // caller's, which is the confused-deputy hazard §13.18 names.
  async "GET /notes/:id"(request: any, ctx: any) {
    const response = await ctx.fetch(
      `/api/projects/default/environments/prod/collections/${ctx.config.collection}/${request.params.id}`
    );
    return { status: response.status, id: request.params.id, body: response.text() };
  },

  // A body, and a write through `ctx`.
  async "POST /notes"(request: any, ctx: any) {
    const sent = JSON.parse(request.body);
    const created = await ctx.entries.create(
      { project: "default", env: "prod" },
      ctx.config.collection,
      { title: sent.title }
    );
    return { status: 201, json: { id: created.id } };
  },

  // Nothing at all is a 204.
  "DELETE /gone"() {},

  // A throw is the plugin *rejecting*, and reaches the caller as a 400 through
  // the same mapping a hook's ValidationError gets — the handler never mentions
  // a status code.
  "GET /refuse"() {
    throw new ValidationError("the greeter refuses", [{ path: "/", message: "no" }]);
  },

  "GET /boom"() {
    throw new Error("kaboom");
  },

  async "GET /slow"() {
    await new Promise(() => {});
  },

  // Calls its own route through ctx, which the causal chain refuses.
  async "GET /loop"(_request: any, ctx: any) {
    const response = await ctx.fetch("/api/ext/greeter/loop");
    return { reached: response.status, body: response.text() };
  },
});
