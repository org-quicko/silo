import type { TransferPlanItem } from "../plan/transfer-plan-item";
import type { TransferPlanLine } from "../plan/transfer-plan-line";
import type { TransferReview } from "../plan/transfer-review";
import type { PreparedTransferPage } from "./prepared-transfer-page";
import type { PreparedTransferRecord } from "./prepared-transfer-record";
import type { PreparedTransferStore } from "./prepared-transfer-store";
import type { PreparedTransferView } from "./prepared-transfer-view";

/** Builds the API's answer for a prepared transfer (D109, D110). */
export class PreparedTransferViews {
  static readonly DefaultLimit = 25;
  static readonly MaxLimit = 100;

  /** The record without its key binding or baseline, plus one page of the plan while the package is held. */
  static async of(
    store: PreparedTransferStore,
    record: PreparedTransferRecord,
    page?: PreparedTransferPage
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
      ...(record.review ? { review: PreparedTransferViews.review(record.review) } : {}),
      ...(record.last_error ? { last_error: record.last_error } : {}),
    };
    if (record.state === "prepared" && record.review && page) {
      const limit = Math.min(page.limit, PreparedTransferViews.MaxLimit);
      const lines = await store.page(record.id, page.offset, limit);
      view.entries = {
        offset: page.offset,
        limit,
        total: record.review.lines,
        items: lines.map((line) => PreparedTransferViews.item(line, page.reveals(line.collection))),
      };
    }
    return view;
  }

  private static review(review: TransferReview): NonNullable<PreparedTransferView["review"]> {
    const { lines: _lines, collections, ...totals } = review;
    return { ...totals, collections: collections.map(({ baseline: _baseline, ...collection }) => collection) };
  }

  private static item(line: TransferPlanLine, revealed: boolean): TransferPlanItem {
    return {
      collection: line.collection,
      ...(line.action !== "deleted" || revealed ? { id: line.id } : {}),
      action: line.action,
      ...(line.rev !== undefined ? { rev: line.rev, updated_at: line.updated_at } : {}),
      ...(revealed && line.destination
        ? { destination: { rev: line.destination.rev, updated_at: line.destination.updated_at } }
        : {}),
      ...(line.reason ? { reason: line.reason } : {}),
    };
  }
}
