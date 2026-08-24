import type { WriteContext } from "./write-context";

/**
 * The write contexts core itself raises. One, because that is how many there
 * are: an API request. A plugin's own writes build their context in
 * `PluginContext`, which cannot use a constant because it carries a depth, and
 * the transfer paths deliberately do not dispatch at all (see `Hooks`).
 *
 * Constants for those two were here and are gone (D7) — a value nothing raises
 * is not vocabulary, it is a claim about behaviour the code does not have.
 */
export class WriteContexts {
  /** An ordinary request. */
  static readonly Api: WriteContext = { origin: "api", depth: 0 };
}
