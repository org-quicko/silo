/**
 * JSON Merge Patch, [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) (D39,
 * with `diff` added by D40).
 *
 * `PATCH /api/plugins/{name}/config` needs a way to change one setting without
 * restating the whole block, and a way to *remove* one. Both are exactly what
 * the RFC defines, and reaching for it rather than inventing a shape is the same
 * choice the README makes everywhere else: silo has no proprietary field
 * language, query language or file format, and a config patch is not the place
 * to start. An operator can read the semantics somewhere that is not this
 * repository.
 *
 * The two rules worth stating without opening the RFC: `null` **deletes** a key,
 * which is why a config value can never legitimately be `null` through this API,
 * and a non-object patch **replaces** whatever it lands on, which is what makes
 * arrays whole values rather than things to merge element-wise.
 *
 * It lives in `shared` because both ends of that request need it: the server
 * applies the patch, and the admin UI has to *produce* one from a form the
 * operator edited as a whole document. Two implementations of the same RFC on
 * either side of one endpoint is the kind of pair that agrees until the day a
 * nested key is deleted.
 */
export class MergePatch {
  /** Apply `patch` to `target`, returning a new document. Neither argument is
   *  mutated — the caller still holds the config that is currently in force,
   *  and a supervisor that has to restore it must find it unchanged. */
  static apply(target: unknown, patch: unknown): unknown {
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      return patch;
    }

    const base: Record<string, unknown> =
      target !== null && typeof target === "object" && !Array.isArray(target)
        ? { ...(target as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (value === null) delete base[key];
      else base[key] = MergePatch.apply(base[key], value);
    }
    return base;
  }

  /** The same, narrowed to the object a plugin's config always is. A patch that
   *  is not an object would replace the whole document with a scalar, which the
   *  route refuses before reaching here. */
  static applyToObject(
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return MergePatch.apply(target, patch) as Record<string, unknown>;
  }

  /**
   * The patch that turns `from` into `to` — the inverse of `apply`, for a
   * caller that edited a whole document and has to send a delta.
   *
   * That is the admin UI's position exactly: an operator fills in a form, and
   * the endpoint takes a patch. Sending the edited document *as* a patch is the
   * mistake this exists to prevent — it looks right and cannot express a
   * deletion, so a key the operator cleared silently survives, nested keys most
   * of all.
   *
   * A removed key becomes `null`, matching values are omitted, and an object on
   * both sides is descended into. Anything else — a scalar, an array, a change
   * of type — is replaced whole, because that is what `apply` does with it.
   */
  static diff(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    for (const key of Object.keys(from)) {
      if (!Object.hasOwn(to, key)) patch[key] = null;
    }

    for (const [key, next] of Object.entries(to)) {
      const previous = from[key];
      if (MergePatch.isObject(previous) && MergePatch.isObject(next)) {
        const nested = MergePatch.diff(previous, next);
        if (Object.keys(nested).length > 0) patch[key] = nested;
        continue;
      }
      // Structural equality by serialization: config documents are small, JSON
      // by construction, and the alternative is a deep-equal of our own.
      if (JSON.stringify(previous) !== JSON.stringify(next)) patch[key] = next;
    }

    return patch;
  }

  private static isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
