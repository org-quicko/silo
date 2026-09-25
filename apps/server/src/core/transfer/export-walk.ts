import { FsLayout } from "../../adapters/storage/fs/fs-layout";
import type { Scope } from "../domain/scope";
import { MediaRefs } from "../media/media-refs";
import type { Storage } from "../ports/storage";
import { ExportEntryFile } from "./export-entry-file";
import { ExportMarker } from "./export-marker";
import type { ExportSink } from "./sink/export-sink";
import type { TransferSelection } from "./transfer-selection";

/**
 * The content half of an export: projects, environments, schemas and entries,
 * written through the sink in a fixed order.
 *
 * Stateful on purpose — the walk has two by-products the rest of the export
 * needs, and both are only complete once every entry has been read: the
 * per-collection counts the manifest reports, and the media references the
 * `referenced` mode filters on (§7.7). That is also why the system scope is
 * written after this and not alongside it.
 */
export class ExportWalk {
  /** Entries read per storage round trip. */
  private static readonly PageSize = 100;

  private readonly store: Storage;
  private readonly sink: ExportSink;
  private readonly selection: TransferSelection;

  /** Keyed "<project>/<env>/<collection>" — what the manifest reports. */
  readonly counts: Record<string, number> = {};
  /** Media usage tokens held by every entry written, in `MediaRefs` form. */
  readonly referenced = new Set<string>();
  /** Ids of the projects actually written. Variables are keyed by project id
   *  (D57), so this is what decides which declarations ride. */
  readonly projectIds = new Set<string>();

  constructor(store: Storage, sink: ExportSink, selection: TransferSelection) {
    this.store = store;
    this.sink = sink;
    this.selection = selection;
  }

  /**
   * Every selected project's directory and marker, including one holding no
   * environment at all — `listScopes()` answers pairs and so could never name
   * it, which is how such a project was silently dropped from every archive
   * before D51.
   */
  async writeProjects(): Promise<void> {
    const records = [...(await this.store.listProjects())].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const project of records) {
      if (!this.selection.coversProject(project.name)) continue;
      this.projectIds.add(project.id);
      await this.sink.directory(`projects/${project.name}`);
      await this.sink.text(
        `projects/${project.name}/${FsLayout.ProjectMarker}`,
        ExportMarker.text(project.id, project.created_at)
      );
    }
  }

  /** Every selected non-system scope, in `listScopes()` order — (project, env). */
  async writeScopes(): Promise<void> {
    for (const scope of await this.store.listScopes()) {
      if (!this.selection.coversScope(scope)) continue;
      await this.writeScope(scope);
    }
  }

  private async writeScope(scope: Scope): Promise<void> {
    const directory = `projects/${scope.project}/${scope.env}`;
    // Written even when nothing below it is: a scope that exists and holds
    // nothing is carried by its directory alone.
    await this.sink.directory(directory);

    const environment = await this.store.findEnvironment(scope.project, scope.env);
    if (environment) {
      await this.sink.text(
        `${directory}/${FsLayout.EnvMarker}`,
        ExportMarker.text(environment.id, environment.created_at)
      );
    }

    const records = (await this.store.listCollections(scope))
      .filter((record) => this.selection.coversCollection(scope, record.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const record of records) {
      await this.sink.text(
        `${directory}/schemas/${record.name}${FsLayout.SchemaSuffix}`,
        JSON.stringify(record.schema, null, 2)
      );
      // The collection's id travels beside its schema, so an import preserves
      // it rather than minting a new one (D51).
      await this.sink.text(
        `${directory}/schemas/.${record.name}${FsLayout.CollectionMarkerSuffix}`,
        ExportMarker.text(record.id, record.created_at)
      );
      this.counts[`${scope.key()}/${record.name}`] = await this.writeEntries(scope, record.name);
    }
  }

  private async writeEntries(scope: Scope, collection: string): Promise<number> {
    let offset = 0;
    let count = 0;
    for (;;) {
      const { items } = await this.store.list(scope, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: ExportWalk.PageSize,
        offset,
      });
      if (items.length === 0) return count;

      for (const entry of items) {
        await this.sink.text(
          ExportEntryFile.path(scope, collection, entry.id),
          ExportEntryFile.text(entry)
        );
        for (const token of MediaRefs.extract(entry.data)) this.referenced.add(token);
        count++;
      }
      offset += items.length;
    }
  }
}
