import { PluginContract } from "../plugin-contract";
import type { HookName } from "../plugin-contract";
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

    const bodies = options.hooks.map((hook) => ExtensionModule.hook(hook, target));

    return `${ExtensionModule.header(options)}

export default defineSiloPlugin({
${bodies.join("\n\n")}
});
`;
  }

  private static header(options: ScaffoldOptions): string {
    // Only what the stubs actually use: an unused `ValidationError` in a file
    // whose first job is to be read is a wrong signal about which hooks reject.
    const rejects = options.hooks.some((hook) => hook !== "entry.afterWrite" && hook !== "entry.afterDelete");
    const imported = rejects ? "defineSiloPlugin, ValidationError" : "defineSiloPlugin";

    const constant = options.withConfig
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
    }
  }
}
