import { ValidationError } from "@silo/shared/validation-error";
import { SiloRef } from "@silo/shared/silo-ref";

// RemoteSchemaLoader fetches http(s) schemas for Ajv's compileAsync. It only
// exists when [schema] allow_remote_refs is enabled — the default validator
// never touches the network (D3 / §5.2: determinism and security).
export class RemoteSchemaLoader {
  static readonly fetchTimeoutMs = 10_000;

  private cache: Map<string, any> = new Map();

  invalidate(): void {
    this.cache.clear();
  }

  async load(uri: string): Promise<any> {
    if (SiloRef.isLocal(uri)) {
      throw new ValidationError(
        `schema references unknown collection "${SiloRef.collectionOf(uri)}"`
      );
    }
    if (!/^https?:\/\//.test(uri)) {
      throw new ValidationError(`unsupported $ref scheme in "${uri}": only http(s) and silo:// are allowed`);
    }

    const cached = this.cache.get(uri);
    if (cached !== undefined) {
      return cached;
    }

    let doc: any;
    try {
      const res = await fetch(uri, {
        signal: AbortSignal.timeout(RemoteSchemaLoader.fetchTimeoutMs),
        headers: { Accept: "application/schema+json, application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      doc = await res.json();
    } catch (err: any) {
      throw new ValidationError(`fetching remote schema "${uri}": ${err.message}`);
    }
    this.cache.set(uri, doc);
    return doc;
  }
}
