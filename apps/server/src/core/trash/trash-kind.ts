/** What a receipt stands for (D91). One list, one API, one restore path. */
export type TrashKind =
  | "project"
  | "environment"
  | "collection"
  | "entry"
  | "media"
  | "media_folder";

export class TrashKinds {
  static readonly All: readonly TrashKind[] = [
    "project",
    "environment",
    "collection",
    "entry",
    "media",
    "media_folder",
  ];

  /**
   * Replay order, parents first. Fixed rather than derived because silo's
   * hierarchy is fixed-depth, so a restore needs no graph walk.
   */
  static readonly RestoreOrder: readonly TrashKind[] = [
    "project",
    "environment",
    "collection",
    "entry",
    "media_folder",
    "media",
  ];

  static isKind(value: unknown): value is TrashKind {
    return typeof value === "string" && TrashKinds.All.includes(value as TrashKind);
  }
}
