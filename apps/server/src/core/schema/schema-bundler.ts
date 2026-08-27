import { SiloRef } from "@silo/shared/silo-ref";
import type { Storage } from "../ports/storage";
import type { Scope } from "../domain/scope";
import type { RemoteSchemaLoader } from "./remote-schema-loader";

export class SchemaBundler {

  /**
   * Automatically bundles local and remote schema references into root.$defs.
   * Local refs (`silo://collections/<name>`) are resolved against the given
   * scope's schemas only. Maintains original property $ref values while
   * fetching and embedding subschemas.
   */
  static async bundle(
    scope: Scope,
    schema: any,
    store: Storage,
    remoteLoader?: RemoteSchemaLoader,
    allowRemoteRefs: boolean = false
  ): Promise<any> {
    if (!schema || typeof schema !== "object") {
      return schema;
    }

    const document = JSON.parse(JSON.stringify(schema));
    const defs: Record<string, any> = document.$defs ? { ...document.$defs } : {};
    const visited = new Set<string>();

    const refs = SchemaBundler.collectRefs(document);

    for (const ref of refs) {
      await SchemaBundler.bundleRef(scope, ref, defs, store, remoteLoader, allowRemoteRefs, visited);
    }

    if (Object.keys(defs).length > 0) {
      document.$defs = defs;
    }

    return document;
  }

  private static collectRefs(node: any, acc: Set<string> = new Set()): Set<string> {
    if (Array.isArray(node)) {
      for (const item of node) {
        SchemaBundler.collectRefs(item, acc);
      }
    } else if (node && typeof node === "object") {
      if (typeof node.$ref === "string") {
        acc.add(node.$ref);
      }
      for (const [k, v] of Object.entries(node)) {
        if (k !== "enum" && k !== "const" && k !== "default" && k !== "examples") {
          SchemaBundler.collectRefs(v, acc);
        }
      }
    }
    return acc;
  }

  private static async bundleRef(
    scope: Scope,
    ref: string,
    defs: Record<string, any>,
    store: Storage,
    remoteLoader?: RemoteSchemaLoader,
    allowRemoteRefs: boolean = false,
    visited: Set<string> = new Set()
  ): Promise<void> {
    if (visited.has(ref) || ref.startsWith("#")) {
      return;
    }
    visited.add(ref);

    let targetSchema: any = null;
    let refId = ref;
    let defKey = ref;

    if (SiloRef.isLocal(ref)) {
      const collectionName = SiloRef.collectionOf(ref);
      defKey = collectionName;
      refId = SiloRef.url(collectionName);
      try {
        targetSchema = await store.getSchema(scope, collectionName);
      } catch {
        return;
      }
    } else if (/^https?:\/\//.test(ref)) {
      if (!allowRemoteRefs || !remoteLoader) {
        return;
      }
      refId = ref;
      defKey = ref;
      try {
        targetSchema = await remoteLoader.load(ref);
      } catch {
        return;
      }
    } else {
      return;
    }

    if (targetSchema && typeof targetSchema === "object") {
      const bundledCopy = JSON.parse(JSON.stringify(targetSchema));
      // Remove any $id on the bundled copy so it doesn't conflict with top-level registered URIs
      delete bundledCopy.$id;

      defs[defKey] = bundledCopy;

      const subRefs = SchemaBundler.collectRefs(targetSchema);
      for (const subRef of subRefs) {
        await SchemaBundler.bundleRef(scope, subRef, defs, store, remoteLoader, allowRemoteRefs, visited);
      }
    }
  }
}
