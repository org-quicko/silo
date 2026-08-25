import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'

/** One choice in the role selector. */
export interface KeyRole {
  value: ClaimPreset
  label: string
  blurb: string
}

/** The four presets a key can be minted with, as the form describes them. */
export class KeyRoles {
  static readonly All: readonly KeyRole[] = [
    { value: 'read', label: 'Read', blurb: 'Read schemas and entries, and list media.' },
    {
      value: 'write',
      label: 'Read & write',
      blurb:
        'Everything Read can do, plus creating, updating and deleting entries and media.',
    },
    {
      value: 'manage',
      label: 'Manage',
      blurb:
        'Everything Read & write can do, plus creating collections, editing schemas, changing public access, and deleting collections.',
    },
    {
      value: 'root',
      label: 'Root',
      blurb:
        'Unrestricted. Ignores the reach above and covers keys, media and data transfer across the whole instance.',
    },
  ]

  /** The media grants a preset carries — surfaced as editable toggles rather
   *  than arriving invisibly with the role. */
  static readonly MediaClaims: readonly Claim[] = [
    Claims.MediaRead,
    Claims.MediaCreate,
    Claims.MediaDelete,
  ]

  static labelOf(preset: ClaimPreset): string {
    return KeyRoles.All.find((role) => role.value === preset)!.label
  }
}
