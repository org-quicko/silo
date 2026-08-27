// Exercises D41: a route that is handed **bytes**, a declared admin panel, and
// work that outlives the dispatch that started it.
//
// The bytes matter because a plugin route used to decode every body as UTF-8 and
// cap it at one mebibyte, so a plugin whose job is reading a file could not be
// handed one. `/later` matters because a plugin's background write used to arrive
// with an empty causal chain, which delivered the plugin its own hooks.
import { defineSiloPlugin } from "silo:api";

/** What `entry.afterWrite` saw. A plugin should never see its own write. */
const seen: string[] = [];
let pending: Promise<void> | null = null;

export default defineSiloPlugin({
  activate() {
    seen.length = 0;
  },

  deactivate() {},

  "entry.afterWrite"(event: any) {
    seen.push(`${event.collection}:${event.origin}:${event.depth}`);
  },

  // `request.bytes` is a Uint8Array and `request.body` is null, because the
  // manifest declared this route as taking bytes.
  "POST /bytes"(request: any) {
    const bytes = request.bytes;
    return {
      json: {
        body: request.body,
        length: bytes ? bytes.byteLength : null,
        // First four bytes, so a test can prove nothing was decoded and re-encoded.
        head: bytes ? [...bytes.slice(0, 4)] : null,
      },
    };
  },

  "POST /small"(request: any) {
    return { json: { length: request.bytes ? request.bytes.byteLength : null } };
  },

  // The default: text, and `bytes` is null.
  "POST /text"(request: any) {
    return { json: { body: request.body, bytes: request.bytes } };
  },

  // Starts a write and answers before it happens, so the write lands with no
  // open dispatch to inherit a causal chain from.
  "POST /later"(request: any, ctx: any) {
    const sent = JSON.parse(request.body);
    pending = (async () => {
      await ctx.entries.create({ project: "default", env: "prod" }, sent.collection, {
        title: "written later",
      });
    })();
    return { status: 202, json: { started: true } };
  },

  async "GET /seen"() {
    if (pending) await pending.catch(() => {});
    return { json: { seen } };
  },
});
