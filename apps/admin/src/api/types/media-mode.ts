/**
 * What a transfer does about media bytes (§7.7).
 *
 * `all` carries every file in the library, `referenced` only the files the
 * transferred entries point at, `none` carries the catalog and no bytes at all.
 */
export type MediaMode = 'all' | 'referenced' | 'none'
