import { ValidationError } from "@silo/shared/validation-error";
import { Scope } from "../../domain/scope";
import { TransferPackageSelection } from "../package/transfer-package-selection";
import { PreparedTransferExpiry } from "./prepared-transfer-expiry";
import type { PreparedTransferRecord } from "./prepared-transfer-record";

/**
 * A prepare request's body, checked whole before anything is fetched (D109):
 * `{source: {url, api_key}, from: {project, env}, selection: [{collection,
 * entry_ids?}], mode?, prefer?, media?}`.
 *
 * The selection is the env-to-env copy's (D22) and is checked by the same
 * rules the source's package route applies, so the two cannot disagree on
 * what a valid pick is.
 */
export class PreparedTransferRequest {
  readonly sourceUrl: string;
  /** Held only for the pull. Nothing writes it down. */
  readonly apiKey: string;
  readonly selection: TransferPackageSelection;
  readonly mode: "merge" | "replace";
  readonly prefer?: "local" | "remote";

  private constructor(
    sourceUrl: string,
    apiKey: string,
    selection: TransferPackageSelection,
    mode: "merge" | "replace",
    prefer?: "local" | "remote"
  ) {
    this.sourceUrl = sourceUrl;
    this.apiKey = apiKey;
    this.selection = selection;
    this.mode = mode;
    this.prefer = prefer;
  }

  static parse(body: unknown): PreparedTransferRequest {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want {source: {url, api_key}, from: {project, env}, selection}");
    }
    const { source, from, selection, mode, prefer, media } = body as Record<string, any>;
    if (!source || typeof source.url !== "string" || typeof source.api_key !== "string" || !source.api_key.trim()) {
      throw new ValidationError("source must be {url, api_key}");
    }
    if (!from || typeof from !== "object") throw new ValidationError("from is required: want {project, env}");
    if (mode !== undefined && mode !== "merge" && mode !== "replace") {
      throw new ValidationError(`invalid transfer mode ${JSON.stringify(mode)}`);
    }
    if (prefer !== undefined && prefer !== "local" && prefer !== "remote") {
      throw new ValidationError(`invalid transfer preference ${JSON.stringify(prefer)}`);
    }
    if (!Array.isArray(selection) || selection.length === 0) {
      throw new ValidationError("selection must be a non-empty array");
    }
    const collections = selection.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ValidationError("each selection item must name a collection");
      }
      const { collection, entry_ids } = item as { collection?: unknown; entry_ids?: unknown };
      return { name: collection, entry_ids };
    });
    const parsed = TransferPackageSelection.parse(Scope.of(from.project, from.env), { collections, media });
    if (mode === "replace" && parsed.collections.some((item) => item.entryIds)) {
      throw new ValidationError("replace mode cannot transfer a selected entry subset; use merge instead");
    }
    return new PreparedTransferRequest(source.url, source.api_key, parsed, mode ?? "merge", prefer);
  }

  get from(): Scope {
    return this.selection.scope;
  }

  /** What the source's `POST …/package` is sent. */
  packageBody(): { collections: { name: string; entry_ids?: string[] }[]; media: string } {
    return {
      collections: this.selection.collections.map((item) => ({
        name: item.name,
        ...(item.entryIds ? { entry_ids: [...item.entryIds] } : {}),
      })),
      media: this.selection.media,
    };
  }

  /** The record a transfer starts as, `preparing`, with everything Apply will use. */
  record(id: string, keyId: string, to: Scope, sourceUrl: string): PreparedTransferRecord {
    const now = new Date();
    return {
      id,
      state: "preparing",
      key_id: keyId,
      to: { project: to.project, env: to.env },
      from: { project: this.from.project, env: this.from.env },
      source_url: sourceUrl,
      selection: this.selection.collections.map((item) => ({
        collection: item.name,
        ...(item.entryIds ? { entry_ids: [...item.entryIds] } : {}),
      })),
      mode: this.mode,
      ...(this.prefer ? { prefer: this.prefer } : {}),
      media: this.selection.media,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: PreparedTransferExpiry.expiresAt(now),
    };
  }
}
