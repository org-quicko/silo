import type { EntryEnvelope } from "./entry-envelope.js";

/**
 * One entry exactly as the API answers it: the author's fields and the
 * envelope in one flat object, with nothing renamed, nested or wrapped.
 *
 * This is a plain value. It carries no transport, no scope and no methods, so
 * it logs as its own contents, survives `structuredClone`, and drops into a
 * store or React state as-is. Writes go through the collection —
 * `posts.replace(id, rev, fields)`, `posts.delete(id, rev)` — where the
 * revision being sent is visible at the call site instead of hidden inside an
 * object (D62).
 */
export type Entry<Fields = Record<string, unknown>> = Fields & EntryEnvelope;
