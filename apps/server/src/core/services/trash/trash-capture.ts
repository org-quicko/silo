import type { AuditActor } from "../../audit/audit-actor";
import type { Entry } from "../../domain/entry";
import { Scope } from "../../domain/scope";
import { MediaCatalog } from "../../media/media-catalog";
import { TrashContentsUtils } from "../../trash/trash-contents";
import type { TrashedAsset } from "../../trash/trash-item";
import { TrashItemUtils } from "../../trash/trash-item";
import type { TrashOrigin } from "../../trash/trash-origin";
import type { ServiceContext } from "../support/service-context";
import { TrashParker } from "./trash-parker";

/**
 * Copies what a delete is about to remove into the trash (D91).
 *
 * Deliberately **copy only**: each method runs before the delete path it
 * belongs to and leaves the live tables alone, so every existing erase keeps
 * its own ordering, counts and hooks. The cost is reading a collection's
 * entries twice; the gain is that no delete path had to be rewritten.
 *
 * Media is the exception and is handled by the caller: an asset's blob must
 * survive the trash, so `MediaService` drops the catalog record without running
 * the deletion saga.
 */
export class TrashCapture {
  private readonly context: ServiceContext;
  private readonly parker: TrashParker;

  constructor(context: ServiceContext, parker: TrashParker) {
    this.context = context;
    this.parker = parker;
  }

  async entry(
    scope: Scope,
    collection: string,
    entry: Entry,
    actor: AuditActor,
    expiresAt: string | null
  ): Promise<string> {
    const origin = await this.originOf(scope, collection);
    const id = await this.parker.begin({
      kind: "entry",
      subjectId: entry.id,
      subjectName: TrashCapture.entryLabel(entry),
      origin,
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    const references = new Set<string>();
    await this.parker.parkEntry(id, entry, contents, references, {
      project_id: origin.project_id ?? "",
      env_id: origin.env_id ?? "",
      collection_id: origin.collection_id ?? "",
    });
    await this.parker.commit(id, contents, references);
    return id;
  }

  async collection(scope: Scope, name: string, actor: AuditActor, expiresAt: string | null): Promise<string> {
    const record = await this.context.store.findCollection(scope, name);
    if (!record) throw new Error(`collection "${name}" not found`);
    const origin = await this.originOf(scope);

    const id = await this.parker.begin({
      kind: "collection",
      subjectId: record.id,
      subjectName: name,
      origin,
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    const references = new Set<string>();
    await this.parker.parkRecord(id, "collection", record);
    TrashContentsUtils.add(contents, { collections: 1 });
    await this.parker.copyEntries(id, scope, name, contents, references, {
      project_id: record.project_id,
      env_id: record.env_id,
      collection_id: record.id,
    });
    await this.parker.commit(id, contents, references);
    return id;
  }

  async environment(project: string, env: string, actor: AuditActor, expiresAt: string | null): Promise<string> {
    const record = await this.context.store.findEnvironment(project, env);
    const projectRecord = await this.context.store.findProject(project);
    if (!record || !projectRecord) throw new Error(`environment "${project}/${env}" not found`);

    const id = await this.parker.begin({
      kind: "environment",
      subjectId: record.id,
      subjectName: env,
      origin: { project_id: projectRecord.id, project_name: project },
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    const references = new Set<string>();
    await this.parker.parkRecord(id, "environment", record);
    await this.copyScope(id, Scope.of(project, env), contents, references);
    await this.parker.commit(id, contents, references);
    return id;
  }

  async project(project: string, actor: AuditActor, expiresAt: string | null): Promise<string> {
    const record = await this.context.store.findProject(project);
    if (!record) throw new Error(`project "${project}" not found`);

    const id = await this.parker.begin({
      kind: "project",
      subjectId: record.id,
      subjectName: project,
      origin: {},
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    const references = new Set<string>();
    await this.parker.parkRecord(id, "project", record);
    for (const environment of await this.context.store.listEnvironments(project)) {
      await this.parker.parkRecord(id, "environment", environment);
      await this.copyScope(id, Scope.of(project, environment.name), contents, references);
    }
    await this.parker.commit(id, contents, references);
    return id;
  }

  /** The `_media` document, without its blob — the bytes outlive the trash and
   *  are destroyed only by a purge. */
  async asset(entry: Entry, actor: AuditActor, expiresAt: string | null): Promise<string> {
    const asset = MediaCatalog.toAsset(entry);
    const id = await this.parker.begin({
      kind: "media",
      subjectId: entry.id,
      subjectName: asset.filename,
      origin: { folder: asset.folder },
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    const parked: TrashedAsset = {
      ...asset,
      state: "active",
      id: entry.id,
      created_at: TrashItemUtils.iso(entry.created_at),
    };
    await this.parker.parkAsset(id, parked, contents);
    await this.parker.commit(id, contents, new Set());
    return id;
  }

  /** A folder record and every asset beneath it, as one receipt. */
  async folder(
    path: string,
    assets: readonly Entry[],
    actor: AuditActor,
    expiresAt: string | null
  ): Promise<string> {
    const id = await this.parker.begin({
      kind: "media_folder",
      subjectId: path,
      subjectName: path.split("/").filter(Boolean).pop() ?? path,
      origin: { folder: TrashCapture.parentOf(path) },
      actor,
      expiresAt,
    });

    const contents = TrashContentsUtils.empty();
    await this.parker.parkRecord(id, "media_folder", { path });
    for (const entry of assets) {
      const asset = MediaCatalog.toAsset(entry);
      await this.parker.parkAsset(
        id,
        { ...asset, state: "active", id: entry.id, created_at: TrashItemUtils.iso(entry.created_at) },
        contents
      );
    }
    await this.parker.commit(id, contents, new Set());
    return id;
  }

  private async copyScope(
    trashId: string,
    scope: Scope,
    contents: ReturnType<typeof TrashContentsUtils.empty>,
    references: Set<string>
  ): Promise<void> {
    for (const record of await this.context.store.listCollections(scope)) {
      await this.parker.parkRecord(trashId, "collection", record);
      TrashContentsUtils.add(contents, { collections: 1 });
      await this.parker.copyEntries(trashId, scope, record.name, contents, references, {
        project_id: record.project_id,
        env_id: record.env_id,
        collection_id: record.id,
      });
    }
  }

  /** Ids and names for the containers a receipt has to point back at. */
  private async originOf(scope: Scope, collection?: string): Promise<TrashOrigin> {
    const project = await this.context.store.findProject(scope.project);
    const environment = await this.context.store.findEnvironment(scope.project, scope.env);
    const record = collection ? await this.context.store.findCollection(scope, collection) : null;
    return {
      project_id: project?.id,
      project_name: scope.project,
      env_id: environment?.id,
      env_name: scope.env,
      collection_id: record?.id,
      collection_name: collection,
    };
  }

  /**
   * A readable name for an entry, which has none of its own. The first short
   * string field, falling back to the id — the same guess the entries list
   * makes when it draws a row.
   */
  private static entryLabel(entry: Entry): string {
    const data = entry.data;
    if (data && typeof data === "object") {
      for (const value of Object.values(data as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim() && value.length <= 120) return value.trim();
      }
    }
    return entry.id;
  }

  private static parentOf(path: string): string {
    const segments = path.split("/").filter(Boolean);
    segments.pop();
    return segments.length ? `/${segments.join("/")}` : "";
  }
}
