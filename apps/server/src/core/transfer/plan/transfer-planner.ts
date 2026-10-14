import { SchemaShape } from "@silo/shared/schema-shape";
import { ValidationError } from "@silo/shared/validation-error";
import type { Entry } from "../../domain/entry";
import { NotFoundError } from "../../errors/not-found-error";
import type { Storage } from "../../ports/storage";
import { CollectionSchemas } from "../../schema/collection-schemas";
import { SchemaChangeGuard } from "../../schema/schema-change-guard";
import { SchemaValidator } from "../../schema/schema-validator";
import { ImportRules } from "../import-rules";
import type { PackagedEntry } from "../package/packaged-entry";
import { TransferMediaPlanner } from "./transfer-media-planner";
import { TransferPlanBaseline } from "./transfer-plan-baseline";
import type { TransferPlanCollection } from "./transfer-plan-collection";
import type { TransferPlanInput } from "./transfer-plan-input";
import type { TransferPlanLine } from "./transfer-plan-line";
import type { TransferReview } from "./transfer-review";

/**
 * Plans a verified package against the destination environment (D110): what
 * Apply will write, decided by the importer's rules, and the baseline it will
 * hold the store to. Reads only.
 *
 * Entries are checked against the **effective** schema, the package's where
 * the plan writes it and the destination's where it does not, because one
 * commit cannot write the schemas first and ask the store, as `Importer` does.
 * A schema change the guard refuses (D70) fails the plan. Media is planned by
 * `TransferMediaPlanner` (D111), and its lines follow the entries'.
 */
export class TransferPlanner {
  /** Destination rows read per page when replace lists what it removes. */
  static readonly Page = 500;

  private readonly store: Storage;
  private readonly input: TransferPlanInput;
  private readonly validator: SchemaValidator;
  private readonly collections = new Map<string, TransferPlanCollection>();
  private readonly media: TransferMediaPlanner;
  private plannedAt = "";
  private lineCount = 0;

  constructor(store: Storage, input: TransferPlanInput) {
    this.store = store;
    this.input = input;
    this.validator = new SchemaValidator(store);
    this.media = new TransferMediaPlanner(store, input);
  }

  /** The plan, one line at a time: each collection's package entries, then what replace removes. */
  async *lines(): AsyncGenerator<TransferPlanLine> {
    this.plannedAt = new Date().toISOString();
    const localInstance = (await this.store.meta()).instance_id;
    const schemas = CollectionSchemas.map(await this.store.listCollections(this.input.to));
    for (const collection of this.input.collections) await this.planSchema(collection, schemas);
    // Media first: an entry line names the references that will not resolve.
    await this.media.plan();

    const packaged = new Map<string, PackagedEntry[]>();
    for (const entry of this.input.entries) {
      if (!packaged.has(entry.collection)) packaged.set(entry.collection, []);
      packaged.get(entry.collection)!.push(entry);
    }
    for (const collection of this.input.collections) {
      const carried = new Set<string>();
      for (const { id } of packaged.get(collection) ?? []) {
        carried.add(id);
        yield this.count(await this.planEntry(collection, id, schemas, localInstance));
      }
      if (this.input.mode === "replace") {
        for await (const line of this.removed(collection, carried)) yield this.count(line);
      }
    }
    for (const line of this.media.lines()) yield this.count(line);
  }

  /** The totals, once `lines` has been read to the end. */
  review(): TransferReview {
    const collections = [...this.collections.values()];
    const sum = (field: "added" | "updated" | "deleted" | "skipped" | "rejected") =>
      collections.reduce((total, collection) => total + collection[field], 0);
    return {
      planned_at: this.plannedAt,
      added: sum("added"),
      updated: sum("updated"),
      deleted: sum("deleted"),
      skipped: sum("skipped"),
      rejected: sum("rejected"),
      lines: this.lineCount,
      collections,
      media: this.media.review(),
    };
  }

  private async planSchema(collection: string, schemas: Map<string, unknown>): Promise<void> {
    const { to, mode, prefer } = this.input;
    const record = await this.store.findCollection(to, collection);
    const incoming = await this.input.content.schema(collection);
    const decision = ImportRules.schema(record?.schema, incoming, mode, prefer);
    if (decision.guarded) await SchemaChangeGuard.assert(this.store, to, collection, incoming);
    if (decision.write) schemas.set(collection, incoming);
    // The guard let a change of shape through only because the collection was empty.
    const rows = mode === "replace" ? "listed" : decision.guarded && !SchemaShape.same(record?.schema, incoming) ? "none" : undefined;
    this.collections.set(collection, {
      collection,
      schema: decision.action,
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      rejected: 0,
      baseline: {
        record: record ? { id: record.id, updated_at: record.updated_at.toISOString() } : null,
        ...(rows ? { rows } : {}),
      },
    });
  }

  private async planEntry(collection: string, id: string, schemas: Map<string, unknown>, localInstance: string): Promise<TransferPlanLine> {
    const { to, mode, prefer, instanceId } = this.input;
    const raw = await this.input.content.entry(collection, id);
    if (!raw) throw new Error(`the verified package lost ${collection}/${id}`);
    const incoming = { rev: raw.rev, updated_at: new Date(raw.updated_at) };
    const local = await this.existing(collection, id);
    const action =
      mode === "replace" || !local
        ? "added"
        : ImportRules.incomingWins(local, incoming, prefer, instanceId, localInstance) ? "updated" : "skipped";
    const line: TransferPlanLine = {
      collection,
      id,
      action,
      rev: incoming.rev,
      updated_at: incoming.updated_at.toISOString(),
      ...(local ? { destination: TransferPlanBaseline.of(local) } : {}),
    };
    if (action === "skipped") return line;
    try {
      await this.validator.validateEntryAgainst(schemas, to, collection, raw.data);
    } catch (caught: any) {
      if (!ValidationError.is(caught)) {
        throw new ValidationError(`the entries of "${collection}" cannot be checked: ${caught?.message ?? caught}`);
      }
      return { ...line, action: "rejected", reason: caught.message };
    }
    const unresolved = await this.media.unresolvedIn(raw.data);
    return unresolved.length > 0 ? { ...line, unresolved } : line;
  }

  /** Every destination row replace overwrites or removes, counted; a line for each one the package does not carry. */
  private async *removed(collection: string, carried: ReadonlySet<string>): AsyncGenerator<TransferPlanLine> {
    const summary = this.collections.get(collection)!;
    const seen = new Set<string>();
    for (let offset = 0; ; ) {
      const items = await this.page(collection, offset);
      if (items.length === 0) return;
      offset += items.length;
      for (const entry of items) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        summary.deleted++;
        if (!carried.has(entry.id)) yield { collection, id: entry.id, action: "deleted", destination: TransferPlanBaseline.of(entry) };
      }
    }
  }

  private count(line: TransferPlanLine): TransferPlanLine {
    this.lineCount++;
    const summary = this.collections.get(line.collection);
    if (summary && line.action !== "deleted" && line.action !== "unchanged") summary[line.action]++;
    return line;
  }

  private async page(collection: string, offset: number): Promise<Entry[]> {
    const query = { sort: [{ path: "$.id", desc: false }], limit: TransferPlanner.Page, offset };
    return (await this.store.list(this.input.to, collection, query).catch(TransferPlanner.absent))?.items ?? [];
  }

  private async existing(collection: string, id: string): Promise<Entry | null> {
    return (await this.store.get(this.input.to, collection, id).catch(TransferPlanner.absent)) ?? null;
  }

  private static absent(caught: unknown): undefined {
    if (caught instanceof NotFoundError) return undefined;
    throw caught;
  }
}
