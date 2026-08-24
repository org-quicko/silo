/**
 * What hands off from the smart bar to the `CommandPalette` overlay: the
 * typed text, and the collection its scope chip named, if any (handoff 1c
 * "Instance"). One shared shape so every page that mounts a `SmartSearch`
 * and the `Workspace` shell that opens the palette from it agree on it.
 */
export interface PaletteSeed {
  q: string
  collection: string | null
}
