import { plugin } from "bun";
import { ValidationError } from "@silo/shared/validation-error";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { SiloVersion } from "../../version";

/**
 * The `silo:api` virtual module, registered in the **host** realm (D31/§13.3).
 *
 * A plugin writes `import { defineSiloPlugin } from "silo:api"` and depends on
 * nothing at runtime — no `@silo/core` in its `package.json`, no bundled copy,
 * no version skew. That is the whole point, and it is not merely tidy: a plugin
 * carrying its own copy of the shared package would reintroduce the cross-realm
 * identity problem `ValidationError.is` already exists to work around, once per
 * plugin. Here there is only ever one copy, so `is` and `instanceof` agree.
 *
 * Verified against a compiled binary: `Bun.plugin()` + `build.module()` reaches
 * a module imported from outside the bundle at runtime, and the reference the
 * plugin receives is identical to the host's.
 *
 * `WorkerSource` registers a matching module inside each worker realm. That one
 * exports *shims* whose `name` matches, because a class cannot cross a
 * structured-clone boundary — see `PluginError`.
 */
export class SiloApi {
  private static registered = false;

  /**
   * Idempotent, and called before any plugin is imported.
   *
   * Registration is global to the realm, so doing it twice would install a
   * second resolver for the same specifier; the guard makes the call safe from
   * both `Cli` and a test that builds a registry directly.
   */
  static register(): void {
    if (SiloApi.registered) return;
    SiloApi.registered = true;

    plugin({
      name: "silo-api",
      setup(build) {
        build.module("silo:api", () => ({
          exports: {
            /** Identity at runtime; it exists so a plugin's default export is
             *  typed, and so the shape has a name to search for. */
            defineSiloPlugin: (definition: unknown) => definition,
            ValidationError,
            ForbiddenError,
            SiloVersion,
          },
          loader: "object",
        }));
      },
    });
  }
}
