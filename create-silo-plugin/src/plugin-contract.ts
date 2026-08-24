/**
 * The parts of silo's plugin contract this scaffolder must know verbatim
 * (D31/§13.2, §13.5, §13.7).
 *
 * Copied rather than imported, because this package publishes on its own and
 * declares **no dependencies at all** — the same property the plugins it emits
 * have, and for the same reason. A copy that drifts is the obvious hazard, so
 * `test/contract-drift.test.ts` asserts every list here against the enum silo
 * actually enforces; a hook added to `HookName` and not added here fails the
 * repo's own suite before anyone scaffolds against it.
 *
 * The three unions below are projections of these arrays rather than
 * hand-written duplicates of silo's types: one artifact, so there is exactly
 * one place a value and its type can disagree, and they cannot.
 */
export class PluginContract {
  /** §13.5. Order is the order the README and the spec table present them,
   *  which is also lifecycle order — the list is read by a human choosing from
   *  it, so alphabetical would be actively worse. */
  static readonly Hooks = [
    "entry.beforeValidate",
    "entry.beforeWrite",
    "entry.afterWrite",
    "entry.beforeDelete",
    "entry.afterDelete",
  ] as const;

  /** One line each, phrased as what the hook *may do* — the distinction that
   *  decides which one an author wants, and the one they most often get wrong. */
  static readonly HookSummaries: Record<HookName, string> = {
    "entry.beforeValidate": "replace data, or reject — the only mutating hook",
    "entry.beforeWrite": "reject only; the data is already validated",
    "entry.afterWrite": "observe only; best-effort, at-most-once",
    "entry.beforeDelete": "reject only; carries the entry, not just its id",
    "entry.afterDelete": "observe only; best-effort, at-most-once",
  };

  static readonly Kinds = ["extension", "provider"] as const;

  static readonly KindSummaries: Record<PluginKind, string> = {
    extension: "registers hooks on the entry lifecycle; runs in a Worker",
    provider: "implements the storage or blob-storage port, adding a driver name",
  };

  /** §13.7. `Searcher` is a port but deliberately not a provider kind. */
  static readonly Ports = ["storage", "blob"] as const;

  /** Driver names the built-in adapters hold. `ProviderRegistry` refuses a
   *  plugin that takes one, so refusing it here turns a failed start into a
   *  question asked while the author is still at the keyboard. */
  static readonly ReservedDrivers = ["sqlite", "fs", "s3"] as const;

  /**
   * A short menu of the claims a plugin usually wants, plus the freeform
   * escape hatch.
   *
   * Deliberately not a validator. The claim grammar lives in `@silo/shared`
   * and depending on it would cost this package its zero-dependency property
   * for a check `silo plugin doctor` performs anyway — and performs against
   * the instance the plugin will actually run on, which is the answer that
   * matters. A menu prevents the common typo without pretending to be the gate.
   */
  static readonly ClaimPresets: readonly { claim: string; summary: string }[] = [
    { claim: "collections:*/*/*:entries:read", summary: "read entries in any collection" },
    { claim: "collections:*/*/*:entries:create", summary: "create entries in any collection" },
    { claim: "collections:*/*/*:entries:update", summary: "update entries in any collection" },
    { claim: "collections:*/*/*:entries:delete", summary: "delete entries in any collection" },
    { claim: "media:read", summary: "read the media catalog" },
  ];

  /** What `[[plugins]] timeout_ms` gets in the generated snippet — silo's own
   *  documented default, so a scaffold and an omitted key behave alike. */
  static readonly DefaultTimeoutMs = 5000;

  static isHook(value: string): value is HookName {
    return (PluginContract.Hooks as readonly string[]).includes(value);
  }

  static isKind(value: string): value is PluginKind {
    return (PluginContract.Kinds as readonly string[]).includes(value);
  }

  static isPort(value: string): value is ProviderPort {
    return (PluginContract.Ports as readonly string[]).includes(value);
  }

  static isReservedDriver(value: string): boolean {
    return (PluginContract.ReservedDrivers as readonly string[]).includes(value);
  }
}

export type HookName = (typeof PluginContract.Hooks)[number];
export type PluginKind = (typeof PluginContract.Kinds)[number];
export type ProviderPort = (typeof PluginContract.Ports)[number];
