import type { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";
import type { DerivedIndex } from "../../ports/derived-index";
import type { Storage } from "../../ports/storage";
import { SearchText } from "../../search/search-text";

/**
 * The derived state a write carries into the adapter's transaction (D23, D30):
 * the media references it makes, and the text it contributes to the index.
 *
 * The schema is fetched here because the extractor needs it and no adapter may
 * have one; a collection without a schema still indexes, just without
 * field weighting.
 */
export class DerivedIndexBuilder {
  private readonly store: Storage;

  constructor(store: Storage) {
    this.store = store;
  }

  async build(
    scope: Scope,
    collection: string,
    data: any,
    usages: string[]
  ): Promise<DerivedIndex> {
    let schema: any;
    try {
      schema = await this.store.getSchema(scope, collection);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    return { usages, search: SearchText.extract(data, schema) };
  }
}
