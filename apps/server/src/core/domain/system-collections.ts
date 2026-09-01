/**
 * Every collection silo keeps its own data in, named once (D51).
 *
 * These were declared in six different files — one per subject that owns its
 * data — which was fine while nothing had to enumerate them. Record keying
 * changes that: `entries.collection_id` is a foreign key, so a system
 * collection needs a `collections` row before anything can be written into it,
 * and both adapters have to seed the same set. A list assembled by hand at each
 * seeding site is a list that will disagree with itself, so the names live here
 * and each subject aliases this.
 *
 * They carry `Schema` rather than a real one: system writes go through
 * `store.put` against `Scope.System` and never reach `EntryService`, so nothing
 * validates against it. `x-silo-*` is reserved for silo (§5.2), which is the
 * honest way to say the row exists for referential integrity.
 */
export type SystemCollection =
  | "_keys"
  | "_media"
  | "_media_folders"
  | "_media_folder_moves"
  | "_plugins"
  | "_audit"
  | "_scope_renames";

export class SystemCollections {
  static readonly Keys = "_keys" as const;
  static readonly Media = "_media" as const;
  static readonly MediaFolders = "_media_folders" as const;
  static readonly MediaFolderMoves = "_media_folder_moves" as const;
  static readonly Plugins = "_plugins" as const;
  static readonly Audit = "_audit" as const;
  static readonly ScopeRenames = "_scope_renames" as const;

  /** What every system collection's row holds in place of a schema. */
  static readonly Schema: Readonly<Record<string, unknown>> = { "x-silo-system": true };

  /** Seeded into both adapters at init, in this order. */
  static readonly All: readonly SystemCollection[] = [
    SystemCollections.Audit,
    SystemCollections.Keys,
    SystemCollections.Media,
    SystemCollections.MediaFolderMoves,
    SystemCollections.MediaFolders,
    SystemCollections.Plugins,
    SystemCollections.ScopeRenames,
  ];

  /**
   * A completeness guard, not a lookup: `Record<Union, true>` means adding a
   * member to `SystemCollection` without listing it above is a compile error,
   * rather than a name that typechecks everywhere and is then missing from the
   * seed. The same discipline `ClaimVocabulary` states for its own tables.
   */
  private static readonly Complete: Record<SystemCollection, true> = {
    _audit: true,
    _keys: true,
    _media: true,
    _media_folder_moves: true,
    _media_folders: true,
    _plugins: true,
    _scope_renames: true,
  };

  /**
   * Whether this is one of silo's own seven.
   *
   * Deliberately **not** the same question as
   * `EntryUtils.isSystemCollection`, which asks whether a name is
   * `_`-prefixed and so reserves the entire namespace. That one is the
   * security boundary and stays the prefix check; this one is the seed list.
   * An unknown `_`-prefixed name is still reserved and still refused — it just
   * has no row.
   */
  static isKnown(name: string): name is SystemCollection {
    return Object.hasOwn(SystemCollections.Complete, name);
  }
}
