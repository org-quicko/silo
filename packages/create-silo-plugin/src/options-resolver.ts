import { PluginContract } from "./plugin-contract";
import { PluginName } from "./plugin-name";
import { Prompter } from "./prompter";
import { SiloRange } from "./silo-range";
import { Style } from "./style";
import type { ArgumentValues } from "./arguments";
import type { HookName, PluginKind, ProviderPort } from "./plugin-contract";
import { ScaffoldRoutes } from "./plugin-routes";
import type { ScaffoldRoute } from "./plugin-routes";
import type { ScaffoldOptions } from "./scaffold-options";

/**
 * Turns whatever the author supplied into a complete `ScaffoldOptions`.
 *
 * The rule is one sentence: **a flag skips its question**. Prompting and
 * `--yes` are not two modes, they are the same resolution with a different
 * source for the answers that are still missing — which is why validation
 * lives here, once, rather than being duplicated on either side of a mode
 * check.
 *
 * A non-TTY stdin is treated as `--yes` rather than as an error. `npm create`
 * inside a script or a CI job has nobody to answer, and hanging on a read that
 * cannot return is the worst of the available failures; taking documented
 * defaults is the least bad.
 */
export class OptionsResolver {
  /** The sentinel for "let me type my own claims". A leading `@` cannot
   *  collide with a real claim: the grammar's first segment is always
   *  `collections`, `keys`, `transfer`, `media` or the bare `*`. */
  private static readonly CustomClaims = "@custom";

  /**
   * The version range is deliberately never prompted for. It is derived from
   * the tool's own version (see `SiloRange`) and shown in the summary — a
   * semver range is a terrible first question, and the derived answer is right
   * far more often than a beginner's guess.
   */
  static async resolve(values: ArgumentValues): Promise<ScaffoldOptions> {
    const interactive = Prompter.interactive && !values.yes;
    const prompter = interactive ? new Prompter() : null;
    try {
      return await OptionsResolver.gather(values, prompter);
    } finally {
      prompter?.close();
    }
  }

  private static async gather(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<ScaffoldOptions> {
    const name = await OptionsResolver.name(values, prompter);
    const note = PluginName.conventionNote(name);
    if (note && prompter) process.stdout.write(`${Style.dim(note)}\n`);

    const directory =
      values.directory ??
      (await prompter?.text("Directory", PluginName.defaultDirectory(name))) ??
      PluginName.defaultDirectory(name);

    const kind =
      values.kind ??
      (await prompter?.choose(
        "What kind of plugin",
        PluginContract.Kinds.map((value) => ({
          value,
          label: value,
          summary: PluginContract.KindSummaries[value],
        }))
      )) ??
      "extension";

    const siloRange = values.siloRange ?? SiloRange.default();
    if (!SiloRange.looksValid(siloRange)) {
      throw new Error(
        `--silo "${siloRange}" is not a version range — try "^1", "^0.2" or ">=0.2 <1".`
      );
    }

    const options: ScaffoldOptions = {
      name,
      directory,
      kind,
      siloRange,
      hooks: [],
      routes: [],
      runtime: false,
      panel: false,
      claims: await OptionsResolver.claims(values, prompter),
      withConfig: await OptionsResolver.withConfig(values, prompter, kind),
      force: values.force,
    };

    if (kind === "extension") {
      options.hooks = await OptionsResolver.hooks(values, prompter);
      options.routes = await OptionsResolver.routes(values, prompter);
      options.panel = await OptionsResolver.panel(values, prompter, options.routes);
      options.runtime = await OptionsResolver.runtime(values, prompter);
      OptionsResolver.assertSomethingCallsIt(options);
    } else {
      options.port = await OptionsResolver.port(values, prompter);
      options.driver = await OptionsResolver.driver(values, prompter, name);
    }

    return options;
  }

  /**
   * `ManifestReader`'s actual rule, applied here so the author hears it while
   * they can still answer.
   *
   * The rule is **not** "an extension declares a hook" — that was true before
   * D36 and is what made this tool require one. It is "something would call
   * it", and since D41 a panel counts, so hooks, routes, a runtime and a panel
   * are four ways to satisfy it.
   */
  private static assertSomethingCallsIt(options: ScaffoldOptions): void {
    if (
      options.hooks.length > 0 ||
      options.routes.length > 0 ||
      options.runtime ||
      options.panel
    ) {
      return;
    }
    throw new Error(
      `a plugin that contributes nothing would never be called. Declare at least one hook ` +
        `(--hooks), a route (--routes), a runtime (--runtime), or a panel (--panel).`
    );
  }

  /**
   * Routes, and the reason the prompt offers an example rather than a menu:
   * unlike hooks there is no closed list to pick from, so the useful help is
   * the grammar.
   */
  private static async routes(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<ScaffoldRoute[]> {
    if (values.routes !== undefined) return values.routes;
    if (!prompter) return [];

    const typed = await prompter.text(
      'Routes, e.g. "GET /status, POST /upload+bytes:8" (blank for none)',
      ""
    );
    return typed.trim().length === 0 ? [] : ScaffoldRoutes.parse(typed);
  }

  /**
   * A panel is offered only when there is a route to reach.
   *
   * Not a restriction — `contributes.ui` on its own is legal — but a panel with
   * no routes can only display what it shipped with, because its one capability
   * is asking the admin to call **this plugin's** routes. Offering it before
   * there is anything to call would be offering a blank screen.
   */
  private static async panel(
    values: ArgumentValues,
    prompter: Prompter | null,
    routes: readonly ScaffoldRoute[]
  ): Promise<boolean> {
    if (values.panel !== undefined) return values.panel;
    if (!prompter || routes.length === 0) return false;
    return await prompter.confirm(
      "Add an admin panel, so an operator can drive those routes from a screen?",
      true
    );
  }

  /** A runtime is implied by a panel: something has to be ready before the
   *  first request the panel makes, and `activate` is where that goes. */
  private static async runtime(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<boolean> {
    if (values.runtime !== undefined) return values.runtime;
    if (!prompter) return false;
    return await prompter.confirm(
      "Run code of its own on activation (activate/deactivate)?",
      false
    );
  }

  /**
   * The scaffolded `config` schema is **extension-only**, and the reason is
   * what the schema contains: one `collection` key, because every generated
   * hook stub opens by asking "is this the collection I care about?". A
   * provider has no such question — its configuration is a bucket, an
   * endpoint, a token, all of them specific to the driver being written — so
   * emitting the extension schema for one produces a manifest that demands a
   * `collection` nothing reads, and refuses the start when the operator omits
   * it.
   *
   * `--config` against a provider is therefore an error rather than a silent
   * no-op: a flag that appears to be honoured and is not is worse than one
   * that says it does not apply. The provider template says where a schema of
   * the author's own goes instead.
   */
  private static async withConfig(
    values: ArgumentValues,
    prompter: Prompter | null,
    kind: PluginKind
  ): Promise<boolean> {
    if (kind === "provider") {
      if (values.withConfig === true) {
        throw new Error(
          `--config is extension-only. A provider's configuration is specific to its driver, ` +
            `so the scaffold leaves "silo.config" for you to write — see the comment on create() in index.ts.`
        );
      }
      return false;
    }

    return (
      values.withConfig ??
      (await prompter?.confirm("Add a config schema, so the operator picks the collection?", true)) ??
      true
    );
  }

  private static async name(values: ArgumentValues, prompter: Prompter | null): Promise<string> {
    const supplied = values.name ?? (await prompter?.text("Plugin name", "silo-plugin-example"));
    if (supplied === undefined) {
      throw new Error(
        `a plugin name is required — pass one as an argument, e.g. "silo-plugin-slugs"`
      );
    }
    const problem = PluginName.problem(supplied);
    if (problem) throw new Error(problem);
    return supplied.trim();
  }

  /**
   * Extensions only, and it may now be empty.
   *
   * The old refusal lived here and was the wrong rule in the wrong place — see
   * `assertSomethingCallsIt`, which asks the question `ManifestReader` actually
   * asks. An author scaffolding a routes-only plugin used to have to name a hook
   * they did not want, which is exactly what D36 objected to about `kind`.
   */
  private static async hooks(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<HookName[]> {
    // The unattended default is a hook only when the author asked for nothing
    // else. `--yes --routes "GET /status"` means a routes plugin, and adding a
    // `entry.beforeValidate` to it would hand them a claim to grant, a stub to
    // delete, and an authority over every write in the instance they never
    // asked for — which is the largest of the three.
    const askedForSomethingElse =
      (values.routes?.length ?? 0) > 0 || values.runtime === true || values.panel === true;

    const chosen =
      values.hooks ??
      (await prompter?.chooseMany<HookName>(
        "Which hooks",
        PluginContract.Hooks.map((hook) => ({
          value: hook,
          label: hook,
          summary: PluginContract.HookSummaries[hook],
        })),
        ["entry.beforeValidate"]
      )) ??
      (askedForSomethingElse ? [] : ["entry.beforeValidate"]);

    // Sorted into lifecycle order rather than the order they were typed, so
    // the manifest and the generated module read top-to-bottom the way the
    // spec table does — and so two authors who pick the same hooks get the
    // same file.
    return PluginContract.Hooks.filter((hook) => chosen.includes(hook));
  }

  private static async claims(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<string[]> {
    if (values.claims !== undefined) return values.claims;
    if (!prompter) return [];

    const picked = await prompter.chooseMany<string>(
      "What should it be allowed to do",
      [
        ...PluginContract.ClaimPresets.map((preset) => ({
          value: preset.claim,
          label: preset.claim,
          summary: preset.summary,
        })),
        {
          value: OptionsResolver.CustomClaims,
          label: "something else",
          summary: "type the claims yourself",
        },
      ],
      []
    );

    const claims = picked.filter((claim) => claim !== OptionsResolver.CustomClaims);
    if (picked.includes(OptionsResolver.CustomClaims)) {
      const typed = await prompter.text("Claims (comma-separated)", "");
      claims.push(...typed.split(",").map((claim) => claim.trim()).filter(Boolean));
    }
    return [...new Set(claims)];
  }

  private static async port(
    values: ArgumentValues,
    prompter: Prompter | null
  ): Promise<ProviderPort> {
    return (
      values.port ??
      (await prompter?.choose<ProviderPort>("Which port", [
        {
          value: "storage",
          label: "storage",
          summary: "entries, schemas and scopes — the whole instance",
        },
        { value: "blob", label: "blob", summary: "the bytes behind uploaded media" },
      ])) ??
      "storage"
    );
  }

  /**
   * The driver name, defaulted from the package name with the conventional
   * prefix stripped — `silo-plugin-turso` suggests `turso`, which is what an
   * operator would want to type in `silo.toml`.
   *
   * A reserved name is refused rather than warned about. `ProviderRegistry`
   * refuses it at startup anyway, and shadowing `sqlite` is a data-loss shape
   * — an installed package silently becoming the store an instance already has
   * data in — not a naming inconvenience.
   */
  private static async driver(
    values: ArgumentValues,
    prompter: Prompter | null,
    name: string
  ): Promise<string> {
    const suggestion = PluginName.unscoped(name).replace(PluginName.Prefix, "") || "custom";
    const driver = values.driver ?? (await prompter?.text("Driver name", suggestion)) ?? suggestion;

    if (PluginContract.isReservedDriver(driver)) {
      throw new Error(
        `"${driver}" is a reserved driver name — silo's built-in adapters hold ` +
          `${PluginContract.ReservedDrivers.join(", ")}, and no plugin may shadow one.`
      );
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(driver)) {
      throw new Error(
        `"${driver}" is not a usable driver name — lowercase letters, digits, "-", "." and "_".`
      );
    }
    return driver;
  }
}
