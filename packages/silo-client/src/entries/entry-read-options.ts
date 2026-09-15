import type { RequestOptions } from "../request-options.js";

/**
 * What every read accepts on top of the cancellation options.
 *
 * `variables: "raw"` answers the `{{NAME}}` templates as stored instead of
 * what they resolve to. An editor wants exactly that: seeding a form with a
 * resolved value and saving it back replaces the reference somebody typed with
 * a snapshot of what it meant in one environment on one day, and a template
 * cannot be recovered from its substitution (D57).
 *
 * Reads resolve by default, because an application reading content should not
 * have to opt in to a usable value.
 */
export interface EntryReadOptions extends RequestOptions {
  variables?: "raw";
}
