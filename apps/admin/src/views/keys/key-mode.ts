/**
 * How the claim list is being written: the three tabs of the key form.
 *
 * They are **modes over one claim list**, not three independent forms. Every
 * mode composes the same `Claim[]`, the review below reads that list and
 * nothing else, and switching tabs carries the list across wherever the target
 * mode can represent it (see `KeyClaimFit`). That is what keeps the tabs from
 * becoming three ways to describe a key that disagree with each other.
 */
export type KeyMode = 'presets' | 'advanced' | 'custom'
