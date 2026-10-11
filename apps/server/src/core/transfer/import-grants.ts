import { Claims } from "@silo/shared/claims";

/**
 * What of `_system` a caller may load (D84), as answers rather than as a key.
 *
 * The importer never sees a key or a route; it is handed these and asks them.
 * Each answer is the claim the same data's own routes ask for: `_keys` is
 * `keys:import`; the media catalog is `media:create`, bytes or not, and
 * `media:delete` when a replace would empty it; `_variables` for a project is
 * what declaring one and valuing one ask for, `create` and `entries:update`
 * over the whole project (every environment, every collection). A row whose
 * project the archive does not name is asked at `null`, which only an
 * instance-wide grant answers. `instance` is whether the audit log and the
 * plugin grants of a whole-instance move may load (D97): no claim reaches
 * that, so only `Trusted` answers yes.
 *
 * `Trusted` is what an in-process caller holds — the CLI on the host, a test —
 * and is also the answer when an import is given none, since a caller that
 * reached the importer without passing through a route has already been
 * trusted with the store itself. The HTTP routes always pass `fromClaims`.
 */
export class ImportGrants {
  readonly keys: boolean;
  readonly media: boolean;
  readonly mediaReplace: boolean;
  readonly variables: (project: string | null) => boolean;
  readonly instance: boolean;

  constructor(answers: {
    keys: boolean;
    media: boolean;
    mediaReplace: boolean;
    variables: (project: string | null) => boolean;
    instance?: boolean;
  }) {
    this.keys = answers.keys;
    this.media = answers.media;
    this.mediaReplace = answers.mediaReplace;
    this.variables = answers.variables;
    this.instance = answers.instance ?? false;
  }

  static readonly Trusted = new ImportGrants({
    keys: true,
    media: true,
    mediaReplace: true,
    variables: () => true,
    instance: true,
  });

  /** Nothing from `_system` at all: what a content-only key amounts to. */
  static readonly None = new ImportGrants({
    keys: false,
    media: false,
    mediaReplace: false,
    variables: () => false,
  });

  static fromClaims(claims: readonly string[]): ImportGrants {
    const held = [...claims];
    return new ImportGrants({
      keys: Claims.has(held, Claims.KeysImport),
      media: Claims.has(held, Claims.MediaCreate),
      mediaReplace: Claims.has(held, Claims.MediaDelete),
      variables: (project) => {
        const reach = project ?? "*";
        return (
          Claims.has(held, Claims.collection(reach, "*", "*", Claims.CollectionCreate)) &&
          Claims.has(held, Claims.collection(reach, "*", "*", Claims.CollectionEntriesUpdate))
        );
      },
    });
  }
}
