import { PluginContract } from "../plugin-contract";
import type { HookName } from "../plugin-contract";
import { ScaffoldRoutes } from "../plugin-routes";
import type { ScaffoldRoute } from "../plugin-routes";
import type { ScaffoldOptions } from "../scaffold-options";

/**
 * The generated `index.ts` for an extension plugin (D31/§13.3, §13.5).
 *
 * One stub per hook the author picked, and every stub **runs** — a scaffold
 * whose output has to be repaired before it does anything has taught the
 * author nothing about whether their setup works. The bodies are deliberately
 * small and deliberately opinionated about the two rules that are invisible
 * from the type signature: which hook may rewrite `data`, and which fires
 * after the write is already committed.
 */
export class ExtensionModule {
  static render(options: ScaffoldOptions): string {
    // The collection guard every stub opens with. With a config schema it is
    // operator-set; without one it is a constant the author edits — either way
    // the stubs read identically, which is the point of having the guard at all.
    const target = options.withConfig ? "ctx.config.collection" : "Collection";

    const bodies = [
      ...(options.runtime ? [ExtensionModule.runtime(options)] : []),
      ...options.hooks.map((hook) => ExtensionModule.hook(hook, target)),
      ...options.routes.map((route) => ExtensionModule.route(route)),
    ];

    return `${ExtensionModule.header(options)}

export default defineSiloPlugin({
${bodies.join("\n\n")}
});
`;
  }

  /**
   * `activate` / `deactivate` (D36).
   *
   * First in the file, because it is the only one that runs unprompted and so
   * the only one whose failure refuses the start.
   */
  private static runtime(options: ScaffoldOptions): string {
    return `  /**
   * Called once when this plugin becomes live, before silo accepts its first
   * request. This is where a plugin does something of its own accord — a timer, a
   * warm cache, a one-off migration — rather than only answering a hook or a
   * route. A throw here refuses the start, so setup that must succeed belongs in it.
   *
   * It grants nothing: \`ctx\` is the same claim-checked surface a hook gets.
   */
  activate(ctx) {
    ctx.log.info("${options.name} is up");
  },

  /** Called once before the worker is torn down. Best-effort and bounded by
   *  \`timeout_ms\`: the decision to stop has already been taken. */
  deactivate(ctx) {
    ctx.log.info("${options.name} is going away");
  },`;
  }

  /**
   * One route stub, keyed exactly as the manifest declares it (§13.18).
   *
   * A handler returns a **value**, never a status code: nothing is a 204, a
   * string is text, any other object is JSON, and `{ status, headers, body }` or
   * `{ json }` sets one explicitly. Throwing `ValidationError` or
   * `ForbiddenError` answers 400 or 403 through the same mapping a hook's
   * refusal gets.
   */
  private static route(route: ScaffoldRoute): string {
    const key = ScaffoldRoutes.key(route);
    const parameters = route.path
      .split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1));
    const mounted = route.path === "/" ? "" : route.path;

    const lines: string[] = [
      `  /** Served at \`/api/ext/<name>${mounted}\`, behind the \`http:route\` claim. */`,
      `  "${key}"(request, ctx) {`,
      `    // A handler runs with **this plugin's** authority and never the caller's,`,
      `    // which is what a plugin route is for — and why exposing one is a decision`,
      `    // the operator makes. \`request.caller\` is who called, minus their credential.`,
    ];

    if (route.body) {
      const mib = route.body.max_bytes / (1024 * 1024);
      lines.push(
        `    // This route declares \`"body": { "kind": "bytes" }\`, so the payload arrives`,
        `    // undecoded in \`request.bytes\` and \`request.body\` is null. ${mib} MiB is the`,
        `    // cap the manifest asks for, and the operator sees it beside the route.`,
        `    const bytes = request.bytes;`,
        `    if (!bytes) throw new ValidationError("send the file as the request body");`,
        `    return { json: { received: bytes.byteLength } };`
      );
    } else if (parameters.length > 0) {
      const fields = parameters.map((name) => `${name}: request.params.${name}`).join(", ");
      lines.push(`    return { json: { ${fields} } };`);
    } else {
      lines.push(`    return { json: { ok: true, caller: request.caller?.label ?? null } };`);
    }

    lines.push(`  },`);
    return lines.join("\n");
  }

  private static header(options: ScaffoldOptions): string {
    // Only what the stubs actually use: an unused `ValidationError` in a file
    // whose first job is to be read is a wrong signal about which hooks reject.
    const observes = ["entry.afterWrite", "entry.afterDelete", "collection.afterDelete"];
    const rejects =
      options.hooks.some((hook) => !observes.includes(hook)) ||
      options.routes.some((route) => route.body !== undefined);
    const imported = rejects ? "defineSiloPlugin, ValidationError" : "defineSiloPlugin";

    // Only when a hook reads it. Every stub opens by asking "is this the
    // collection I care about?", so a routes-only or panel-only scaffold has
    // nothing to compare against — and a constant nothing reads is the first
    // thing an author deletes wondering what it was for.
    const constant =
      options.withConfig || options.hooks.length === 0
        ? ""
        : `\n/** The collection this plugin acts on. Change it, or add a \`config\` schema\n *  to the manifest and let the operator set it in \`silo.toml\`. */\nconst Collection = "posts";\n`;

    return `import { ${imported} } from "silo:api";
${constant}
// \`silo:api\` is a **virtual module**: it has no file on disk and is not on
// npm. silo injects it into this plugin's import graph before the plugin
// loads, which is why this package depends on nothing — and why there is one
// \`ValidationError\` in play rather than one per plugin. \`silo-api.d.ts\` next
// to this file is the type declaration; it contributes nothing at runtime.`;
  }

  private static hook(hook: HookName, target: string): string {
    const guard = `    if (event.collection !== ${target}) return;`;
    const doc = `  /** ${PluginContract.HookSummaries[hook]} */`;

    switch (hook) {
      case "entry.beforeValidate":
        return `${doc}
  "entry.beforeValidate"(event, ctx) {
${guard}

    const title = event.data?.title;
    if (typeof title !== "string") throw new ValidationError(\`\${event.collection} needs a title\`);

    // Return \`{ data }\` to replace the value, or nothing to leave it alone.
    // This runs **before** validation, so the schema judges exactly what is
    // returned here — which is also exactly what gets stored.
    return { data: { ...event.data, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-") } };
  },`;

      case "entry.beforeWrite":
        return `${doc}
  "entry.beforeWrite"(event, ctx) {
${guard}

    // Veto-only. The data is validated and the envelope is built by now, so
    // rewriting here would store a value the schema never saw. Throwing
    // \`ValidationError\` rejects the write as a 400; \`ForbiddenError\` as a 403.
    if (event.data?.locked === true) throw new ValidationError("this entry is locked");
  },`;

      case "entry.afterWrite":
        return `${doc}
  "entry.afterWrite"(event, ctx) {
${guard}

    // \`origin\` is \`api\` for a request and \`plugin:<name>\` for a write another
    // plugin made. Check it before writing through \`ctx\` — two plugins that
    // do not will ping-pong invisibly.
    if (event.origin !== "api") return;

    // Observe only, and off the critical path: this fires outside the write
    // mutex, best-effort and at-most-once. A throw here is logged and dropped;
    // it never fails the request, because the write already committed.
    ctx.log.info("entry written", { op: event.op, id: event.id, rev: event.rev });
  },`;

      case "entry.beforeDelete":
        return `${doc}
  "entry.beforeDelete"(event, ctx) {
${guard}

    // Carries the entry, not just its id — so a veto can read what is about to
    // go away.
    if (event.data?.published === true) throw new ValidationError("unpublish before deleting");
  },`;

      case "entry.afterDelete":
        return `${doc}
  "entry.afterDelete"(event, ctx) {
${guard}

    ctx.log.info("entry deleted", { id: event.id });
  },`;

      case "collection.afterDelete":
        return `${doc}
  "collection.afterDelete"(event, ctx) {
${guard}

    // One event for the whole collection, however many entries it held — this is
    // the only way a plugin hears about a forced delete, which erases entries
    // without dispatching \`entry.afterDelete\` for each of them. \`cause\` says
    // whether the scope above it is going too.
    ctx.log.info("collection erased", { erased: event.erased, cause: event.cause });
  },`;
    }
  }
}
