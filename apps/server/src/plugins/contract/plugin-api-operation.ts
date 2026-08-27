import type { PluginApiParameter } from "./plugin-api-parameter";

/** One method of the generated client, and the route it stands for (D35). */
export interface PluginApiOperation {
  /**
   * Dotted, `group.method` — `entries.list`. The group is what the emitted
   * client nests it under, so it is structure rather than naming convention.
   */
  name: string;

  method: "GET" | "POST" | "PUT" | "DELETE";

  /**
   * The route's path with `{placeholder}` segments, exactly as
   * `docs/design/http-api.md` writes it.
   *
   * The `/environments/` spelling and not `/envs/`: both are registered and the
   * long one is canonical, so the generated client uses the form the
   * documentation does rather than the abbreviation.
   */
  path: string;

  parameters: readonly PluginApiParameter[];

  /** What goes inside `Promise<>` in the emitted declaration. `void` emits a
   *  method that resolves to nothing, which is what a 204 route answers. */
  returns: string;

  /** One line, emitted as the method's doc comment. It is the only description
   *  a plugin author sees at the keyboard, so it says what the call *does*
   *  rather than restating its name. */
  summary: string;
}
