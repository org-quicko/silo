import type { PreparedTransferRecord } from "./prepared-transfer-record";
import type { PreparedTransferStore } from "./prepared-transfer-store";
import type { PreparedTransferView } from "./prepared-transfer-view";

/** Builds the API's answer for a prepared transfer (D109). */
export class PreparedTransferViews {
  static readonly DefaultLimit = 25;
  static readonly MaxLimit = 100;

  /** The record without its key binding, plus one page of entries while the package is held. */
  static async of(
    store: PreparedTransferStore,
    record: PreparedTransferRecord,
    page?: { offset: number; limit: number }
  ): Promise<PreparedTransferView> {
    const view: PreparedTransferView = {
      id: record.id,
      state: record.state,
      created_at: record.created_at,
      updated_at: record.updated_at,
      expires_at: record.expires_at,
      source: { url: record.source_url },
      from: record.from,
      to: record.to,
      selection: record.selection,
      mode: record.mode,
      ...(record.prefer ? { prefer: record.prefer } : {}),
      media: record.media,
      ...(record.package ? { package: record.package } : {}),
      ...(record.last_error ? { last_error: record.last_error } : {}),
    };
    if (record.state === "prepared" && record.package && page) {
      const total = record.package.collections.reduce((sum, collection) => sum + collection.entries, 0);
      const limit = Math.min(page.limit, PreparedTransferViews.MaxLimit);
      view.entries = { offset: page.offset, limit, total, items: await store.page(record.id, page.offset, limit) };
    }
    return view;
  }
}
