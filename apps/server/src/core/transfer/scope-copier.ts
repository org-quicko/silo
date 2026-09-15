import type { Storage } from "../ports/storage";
import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";
import { ValidationError } from "@silo/shared/validation-error";
import { FormatVersion } from "./format-version";
import type { ExportManifest } from "./export-manifest";
import { CollectionSchemas } from "../schema/collection-schemas";
import { Importer } from "./importer";
import type { ScopedImport } from "./import-walker";
import type { ImportResult } from "./import-result";
import type { ScopeCopyOptions } from "./scope-copy-options";
import type { ScopeCopySelection } from "./scope-copy-options";
import { NotFoundError } from "../errors/not-found-error";
import { Claims } from "@silo/shared/claims";
import { EntryUtils } from "../domain/entry-utils";

/**
 * Copies one scope's schemas and entries onto another scope of the **same
 * instance** — the env→env move an archive round trip used to be the only way
 * to make (D22).
 *
 * It owns no merge logic of its own. `Importer.executeImport` already takes
 * `{manifest, scopes}` in memory rather than a directory, so this class only
 * has to read the source scope out of `Storage` into the same `ScopedImport`
 * shape `ImportWalker` produces from an archive. Merge/replace, `prefer`, and
 * dry-run therefore have exactly one implementation, and a change to import
 * semantics cannot silently diverge from copy semantics.
 *
 * Media is deliberately untouched: blob storage is instance-global and
 * unscoped, so there is no per-scope subset of it to move.
 */
export class ScopeCopier {
  static async copy(
    store: Storage,
    from: Scope,
    to: Scope,
    opts: ScopeCopyOptions,
  ): Promise<ImportResult> {
    ScopeCopier.validate(from, to);
    ScopeCopier.validateSelection(opts);

    const meta = await store.meta();
    // `instance_id` is read from the same instance on both sides, so the
    // importer's last-resort tiebreak (`manifest.instance_id > local`) is
    // false and an entry identical in `updated_at` and `rev` is skipped.
    // That is the right answer here: nothing distinguishes the two copies.
    const manifest: ExportManifest = {
      format_version: FormatVersion,
      instance_id: meta.instance_id,
      last_seq: meta.last_seq,
    };

    const scoped = await ScopeCopier.read(store, from, to, opts.selection);
    return Importer.executeImport(store, { manifest, scopes: [scoped] }, opts);
  }

  /** Service callers bypass HTTP, so the subset safety rule lives here too. */
  private static validateSelection(options: ScopeCopyOptions): void {
    const selection = options.selection;
    if (!selection) return;
    if (selection.length === 0) throw new ValidationError("selection must be a non-empty array");
    if (options.mode === "replace" && selection.some((item) => item.entryIds !== undefined)) {
      throw new ValidationError("replace mode cannot copy a selected entry subset; use merge instead");
    }
    const collections = new Set<string>();
    for (const item of selection) {
      if (typeof item.collection !== "string" || !Claims.isCollectionName(item.collection) || item.collection.startsWith("_")) {
        throw new ValidationError(`invalid selected collection "${String(item.collection)}"`);
      }
      if (collections.has(item.collection)) throw new ValidationError(`duplicate selected collection "${item.collection}"`);
      collections.add(item.collection);
      if (item.entryIds !== undefined) {
        if (item.entryIds.length === 0) throw new ValidationError(`entry_ids for "${item.collection}" must be non-empty`);
        if (new Set(item.entryIds).size !== item.entryIds.length) {
          throw new ValidationError(`duplicate selected entry id in collection "${item.collection}"`);
        }
        for (const id of item.entryIds) EntryUtils.assertSafeSegment(id, "selected entry id");
      }
    }
  }

  private static validate(from: Scope, to: Scope): void {
    if (from.isSystem() || to.isSystem()) {
      throw new ValidationError("the system scope cannot be copied from or into");
    }
    if (from.equals(to)) {
      throw new ValidationError(
        `source and destination are the same scope ("${from.key()}")`,
      );
    }
  }

  /**
   * Reads `from` into an import unit addressed at `to`. Entries are
   * re-enveloped onto the destination scope, the same rule `ImportWalker`
   * applies to an archive: the address the caller named is authoritative and
   * the envelope's own `project`/`env` are overwritten from it (D18).
   */
  private static async read(
    store: Storage,
    from: Scope,
    to: Scope,
    selection?: ScopeCopySelection[],
  ): Promise<ScopedImport> {
    const schemas = CollectionSchemas.map(await store.listCollections(from));
    for (const name of schemas.keys()) {
      if (ScopeCopier.isReserved(name)) schemas.delete(name);
    }

    // One read, as `Exporter` now does: since D51 every collection is a record,
    // so there is no collection holding entries that a schema-derived list
    // would drop.
    const selected = new Map(selection?.map((item) => [item.collection, item.entryIds]) ?? []);
    if (selection) {
      for (const collection of selected.keys()) {
        if (!schemas.has(collection)) {
          throw new ValidationError(`source collection "${collection}" does not exist`);
        }
      }
      for (const collection of [...schemas.keys()]) {
        if (!selected.has(collection)) schemas.delete(collection);
      }
    }

    const names = [...schemas.keys()].sort();

    const entries = new Map<string, Entry[]>();
    for (const name of names) {
      entries.set(name, await ScopeCopier.readEntries(store, from, to, name, selected.get(name)));
    }
    // No ids: a copy into another scope of the same instance creates new
    // collection records there rather than carrying the source's identity, the
    // same way it does not carry `seq`.
    return { scope: to, schemas, entries, collectionIds: new Map() };
  }

  private static async readEntries(
    store: Storage,
    from: Scope,
    to: Scope,
    collection: string,
    selectedIds?: string[],
  ): Promise<Entry[]> {
    if (selectedIds) {
      const items: Entry[] = [];
      for (const id of selectedIds) {
        try {
          const entry = await store.get(from, collection, id);
          items.push({ ...entry, project: to.project, env: to.env });
        } catch (caught) {
          if (caught instanceof NotFoundError) {
            throw new ValidationError(`source entry "${id}" does not exist in collection "${collection}"`);
          }
          throw caught;
        }
      }
      return items;
    }
    const items: Entry[] = [];
    let offset = 0;
    while (true) {
      const page = await store.list(from, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: 100,
        offset,
      });
      if (page.items.length === 0) break;
      for (const e of page.items) {
        items.push({ ...e, project: to.project, env: to.env });
      }
      offset += page.items.length;
    }
    return items;
  }

  /** System collections (`_keys`) are instance data, not a scope's content. */
  private static isReserved(collection: string): boolean {
    return collection.startsWith("_");
  }
}
