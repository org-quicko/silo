/**
 * Where a write came in from (D31/§13.5).
 *
 * Context only — **never persisted**. Writing it into the entry would change
 * the on-disk layout and force a `format_version` bump (D14) for what is only
 * ever a debugging aid.
 *
 * A plugin reads it to ignore its own events, which is what keeps two plugins
 * from ping-ponging writes at each other invisibly.
 *
 * `"import"` is **reserved rather than raised**: the transfer paths do not
 * dispatch hooks, so nothing produces it today. It is kept for the same reason
 * `/api/plugins/` is reserved — reaching those paths is §12.8 work, and it must
 * not have to change a payload shape 1.0 froze. A `"cli"` member was here on no
 * such argument and with no producer, and is gone (D7): the reservation is the
 * exception, not the pattern.
 */
export type HookOrigin = "api" | "import" | `plugin:${string}`;
