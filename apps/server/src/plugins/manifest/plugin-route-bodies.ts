import type { PluginRouteBody, PluginRouteBodyKind } from "./plugin-route-body";

/** The `PluginRouteBody` vocabulary, as values — the counterpart to
 *  `PluginRoutes` for the route itself (D41). */
export class PluginRouteBodies {
  static readonly Kinds: readonly PluginRouteBodyKind[] = ["text", "bytes"];

  /**
   * What a route that declares no body gets: exactly D36's behaviour.
   *
   * The default is the old constant and not a smaller one, so adding this field
   * changed no existing plugin's behaviour and no existing manifest's meaning.
   */
  static readonly DefaultMaxBytes = 1024 * 1024;

  /**
   * The largest `max_bytes` a manifest may declare, whatever it asks for.
   *
   * A ceiling exists because the body crosses a structured-clone boundary as one
   * value: there is no back-pressure to be had, so the declared number is a
   * standing instruction to allocate. An author-chosen unbounded one would be an
   * author-chosen denial of service against the operator who installed them, and
   * "installing is the trust boundary" is an argument about *code*, not a reason
   * to let a manifest name any integer.
   *
   * 64 MiB because it clears the payloads this exists for — a Strapi transfer, a
   * CSV export, an archive — by more than an order of magnitude, and because the
   * honest way past it is a streaming body, which §13.18 rules out for reasons
   * this number cannot fix.
   */
  static readonly Ceiling = 64 * 1024 * 1024;

  static readonly Default: PluginRouteBody = {
    kind: "text",
    max_bytes: PluginRouteBodies.DefaultMaxBytes,
  };

  static isKind(value: unknown): value is PluginRouteBodyKind {
    return (
      typeof value === "string" && (PluginRouteBodies.Kinds as readonly string[]).includes(value)
    );
  }

  /** Whether this declaration says anything the default did not — what decides
   *  if a summary or a grant screen mentions it at all. */
  static isDefault(body: PluginRouteBody): boolean {
    return (
      body.kind === PluginRouteBodies.Default.kind &&
      body.max_bytes === PluginRouteBodies.Default.max_bytes
    );
  }

  /** `"bytes, up to 32 MiB"` — for the CLI, the log and the grant screen, so
   *  the three say it the same way. */
  static phrase(body: PluginRouteBody): string {
    return `${body.kind}, up to ${PluginRouteBodies.size(body.max_bytes)}`;
  }

  /** Mebibytes when it divides evenly, bytes otherwise. An operator reading a
   *  cap wants the number the author typed, not a rounding of it. */
  static size(bytes: number): string {
    const mib = bytes / (1024 * 1024);
    return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`;
  }
}
