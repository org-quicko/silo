/**
 * How much a key can do inside one (project, env) scope, widest first.
 * Derived from claims by `Claims.accessLevel` — never stored on a key.
 */
export type AccessLevel = "root" | "write" | "read" | "none";
