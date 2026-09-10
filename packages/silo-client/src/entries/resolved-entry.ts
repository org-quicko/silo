import { EntryBase } from "./entry-base.js";

/**
 * A read whose variables have been substituted. Adds nothing over
 * {@link EntryBase}: no `save()`, no `refresh()` — writing a resolved value
 * back would overwrite whatever `{{NAME}}` template produced it. `fields` is
 * narrowed to `Readonly<Fields>` at the type level; `Entry` is what an
 * editor asks for instead.
 */
export class ResolvedEntry<Fields> extends EntryBase<Fields> {
  declare readonly fields: Readonly<Fields>;
}
