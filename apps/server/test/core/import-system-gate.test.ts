import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { FsLayout } from "../../src/adapters/storage/fs/fs-layout";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { SystemCollections } from "../../src/core/domain/system-collections";
import { Exporter } from "../../src/core/transfer/exporter";
import { FormatVersion } from "../../src/core/transfer/format-version";
import { ImportGrants } from "../../src/core/transfer/import-grants";
import { Importer } from "../../src/core/transfer/importer";

/**
 * What of `_system` an import may write (D84). The 2026-09-18 audit's H3: a
 * key holding `transfer:import` and write on one collection could post an
 * archive that also carried `_audit`, `_variables` or `_media` rows, and the
 * importer wrote them all, because only `_keys` was ever gated.
 */
describe("import gates the _system half of an archive", () => {
  let tempDir: string;
  let destination: SqliteStore;

  /** An archive written by hand, the way an attacker would. */
  const archive = async (
    name: string,
    contents: {
      projects?: { name: string; id: string }[];
      system?: Record<string, Record<string, unknown>[]>;
    }
  ): Promise<string> => {
    const root = path.join(tempDir, name);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ format_version: FormatVersion, instance_id: "attacker", last_seq: 0 })
    );
    for (const project of contents.projects ?? []) {
      const dir = path.join(root, "projects", project.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, FsLayout.ProjectMarker), JSON.stringify({ id: project.id }));
    }
    const system = path.join(root, "projects", Scope.System.project, Scope.System.env);
    for (const [collection, rows] of Object.entries(contents.system ?? {})) {
      await fs.mkdir(path.join(system, "schemas"), { recursive: true });
      await fs.writeFile(
        path.join(system, "schemas", `${collection}${FsLayout.SchemaSuffix}`),
        JSON.stringify(SystemCollections.Schema)
      );
      const content = path.join(system, "content", collection);
      await fs.mkdir(content, { recursive: true });
      for (const data of rows) {
        const id = EntryUtils.newID();
        await fs.writeFile(
          path.join(content, `${id}.json`),
          JSON.stringify({
            id,
            rev: 1,
            seq: 0,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            data,
          })
        );
      }
    }
    return root;
  };

  const variable = (projectId: string) => ({
    project_id: projectId,
    name: "API_URL",
    description: "",
    values: {},
  });

  const catalogRow = {
    filename: "planted.png",
    folder: "/",
    blob_key: "planted.png",
    size: 1,
    content_type: "image/png",
    hash: "h",
    state: "active",
    tags: [],
  };

  const only = (answers: Partial<ConstructorParameters<typeof ImportGrants>[0]>) =>
    new ImportGrants({
      keys: false,
      media: false,
      mediaReplace: false,
      variables: () => false,
      ...answers,
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-gate-"));
    destination = await SqliteStore.open(path.join(tempDir, "destination.db"));
  });

  afterEach(async () => {
    await destination.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("_audit, _plugins and _scope_renames never import, whoever asks", async () => {
    for (const collection of [
      SystemCollections.Audit,
      SystemCollections.Plugins,
      SystemCollections.ScopeRenames,
    ]) {
      const source = await archive(`never-${collection}`, {
        system: { [collection]: [{ forged: true }] },
      });
      const refused = Importer.importDir(destination, source, { grants: ImportGrants.Trusted });
      await refused.catch(() => {});
      await expect(refused).rejects.toThrow(/never imports/);
    }
    expect(
      (await destination.list(Scope.System, SystemCollections.Audit, { limit: 10, offset: 0 })).total
    ).toBe(0);
  });

  test("a _system collection silo does not know is refused, even empty", async () => {
    const source = await archive("unknown", { system: { _evil: [] } });
    const refused = Importer.importDir(destination, source, { grants: ImportGrants.Trusted });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/not a system collection silo knows/);
  });

  test("variables need the declaring and valuing authority for their project, by name", async () => {
    const source = await archive("variables", {
      projects: [{ name: "site", id: "PROJECT-SITE" }],
      system: { [SystemCollections.Variables]: [variable("PROJECT-SITE")] },
    });

    const refused = Importer.importDir(destination, source, {
      grants: only({ variables: (project) => project === "shop" }),
    });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/variables for project "site"/);

    const result = await Importer.importDir(destination, source, {
      grants: only({ variables: (project) => project === "site" }),
    });
    expect(result.added).toBe(1);
  });

  test("a variable for a project the archive does not name is asked at the instance", async () => {
    const source = await archive("orphan-variable", {
      system: { [SystemCollections.Variables]: [variable("PROJECT-NOBODY")] },
    });
    const asked: (string | null)[] = [];
    const refused = Importer.importDir(destination, source, {
      grants: only({
        variables: (project) => {
          asked.push(project);
          return false;
        },
      }),
    });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/does not name/);
    expect(asked).toEqual([null]);
  });

  test("catalog rows need media:create, bytes or not, and media:delete to be replaced", async () => {
    const source = await archive("catalog", {
      system: { [SystemCollections.Media]: [catalogRow] },
    });

    const refused = Importer.importDir(destination, source, { media: "none", grants: only({}) });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/media catalog/);

    const emptying = Importer.importDir(destination, source, {
      mode: "replace",
      grants: only({ media: true }),
    });
    await emptying.catch(() => {});
    await expect(emptying).rejects.toThrow(/would empty/);

    const result = await Importer.importDir(destination, source, {
      mode: "replace",
      grants: only({ media: true, mediaReplace: true }),
    });
    expect(result.added).toBe(1);
  });

  test("keys still need keys:import, as before", async () => {
    const source = await archive("keys", { system: { [SystemCollections.Keys]: [] } });
    const refused = Importer.importDir(destination, source, { grants: only({}) });
    await refused.catch(() => {});
    await expect(refused).rejects.toThrow(/keys:import/);
  });

  test("an ordinary export's empty _system half loads with no system grant at all", async () => {
    // Every export carries the riding collections' placeholder schemas; a key
    // that may load content must be able to load an archive that merely
    // describes an empty library.
    const source = await SqliteStore.open(path.join(tempDir, "source.db"));
    try {
      await source.putSchema(Scope.Default, "posts", { type: "object" });
      const exported = path.join(tempDir, "exported");
      await Exporter.exportDir(source, exported, {});
      const result = await Importer.importDir(destination, exported, { grants: ImportGrants.None });
      expect(result.rejected).toBe(0);
    } finally {
      await source.close();
    }
  });

  test("grants are read off claims the way the routes read them", () => {
    const root = ImportGrants.fromClaims([Claims.Root]);
    expect([root.keys, root.media, root.mediaReplace, root.variables("x"), root.variables(null)]).toEqual([
      true, true, true, true, true,
    ]);

    const narrow = ImportGrants.fromClaims([
      Claims.KeysImport,
      Claims.collection("site", "*", "*", Claims.CollectionCreate),
      Claims.collection("site", "*", "*", Claims.CollectionEntriesUpdate),
      Claims.collection("shop", "*", "*", Claims.CollectionCreate),
    ]);
    expect(narrow.keys).toBe(true);
    expect(narrow.media).toBe(false);
    expect(narrow.mediaReplace).toBe(false);
    expect(narrow.variables("site")).toBe(true);
    // Only half of what valuing a variable asks for.
    expect(narrow.variables("shop")).toBe(false);
    expect(narrow.variables(null)).toBe(false);

    const wide = ImportGrants.fromClaims([
      Claims.collection("*", "*", "*", Claims.CollectionCreate),
      Claims.collection("*", "*", "*", Claims.CollectionEntriesUpdate),
    ]);
    expect(wide.variables(null)).toBe(true);
  });
});
