import { SiloRef } from "@silo/shared/silo-ref";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { NotFoundError } from "../errors/not-found-error";
import { ValidationError } from "@silo/shared/validation-error";
import type { ValidationDetail } from "@silo/shared/validation-detail";
import type { Storage } from "../ports/storage";
import type { Scope } from "../domain/scope";
import { RemoteSchemaLoader } from "./remote-schema-loader";

export interface SchemaValidatorOptions {
  allowRemoteRefs?: boolean;
}

export class SchemaValidator {

  private store: Storage;
  private allowRemoteRefs: boolean;
  private remoteLoader: RemoteSchemaLoader = new RemoteSchemaLoader();
  // Keyed by `${scope.key()}:${collection}` so the same collection name in
  // two different scopes never shares a compiled validator.
  private cache: Map<string, any> = new Map();

  constructor(store: Storage, opts: SchemaValidatorOptions = {}) {
    this.store = store;
    this.allowRemoteRefs = opts.allowRemoteRefs === true;
  }

  static schemaURL(collection: string): string {
    return SiloRef.url(collection);
  }

  invalidate(): void {
    this.cache.clear();
    this.remoteLoader.invalidate();
  }

  async checkSchemaDoc(scope: Scope, collection: string, raw: any): Promise<void> {
    const all = await this.store.listSchemas(scope);
    all.set(collection, raw);
    try {
      await this.compileFrom(all, collection);
    } catch (err: any) {
      if (ValidationError.is(err)) {
        throw err;
      }
      throw new ValidationError(`invalid JSON Schema: ${SchemaValidator.refError(err)}`);
    }
  }

  async validateEntry(scope: Scope, collection: string, data: any): Promise<void> {
    const cacheKey = `${scope.key()}:${collection}`;
    let validateFn = this.cache.get(cacheKey);
    if (!validateFn) {
      const all = await this.store.listSchemas(scope);
      if (!all.has(collection)) {
        throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
      }
      try {
        validateFn = await this.compileFrom(all, collection);
        this.cache.set(cacheKey, validateFn);
      } catch (err: any) {
        throw new Error(`compiling schema for "${collection}": ${SchemaValidator.refError(err)}`);
      }
    }

    const valid = validateFn(data);
    if (!valid) {
      const details: ValidationDetail[] = (validateFn.errors || []).map((err: any) => {
        return {
          path: err.instancePath || "",
          message: err.message || "unknown validation error",
        };
      });
      throw new ValidationError("validation failed", details);
    }
  }

  getRemoteLoader(): RemoteSchemaLoader {
    return this.remoteLoader;
  }

  getAllowRemoteRefs(): boolean {
    return this.allowRemoteRefs;
  }

  // `all` is already scoped to one (project, env) by the caller, so refs
  // resolve only against that scope's schemas — cross-scope $refs are not
  // supported (D18 / §9).
  private async compileFrom(all: Map<string, any>, collection: string) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      loadSchema: this.allowRemoteRefs ? (uri: string) => this.remoteLoader.load(uri) : undefined,
    });
    addFormats(ajv);

    for (const [name, schema] of all.entries()) {
      try {
        ajv.addSchema(schema, SchemaValidator.schemaURL(name));
      } catch (err: any) {
        if (!err?.message?.includes("already exists")) {
          throw err;
        }
      }
    }

    // A wrapper $ref lets compileAsync resolve the registered document plus any
    // refs it can't find locally (remote fetch via loadSchema when enabled).
    const url = SchemaValidator.schemaURL(collection);
    if (this.allowRemoteRefs) {
      return await ajv.compileAsync({ $ref: url });
    }
    const validate = ajv.getSchema(url);
    if (!validate) {
      throw new Error(`failed to compile schema for ${url}`);
    }
    return validate;
  }

  // refError turns Ajv's MissingRefError into an actionable message: unknown
  // local collections and the allow_remote_refs opt-in are named explicitly.
  private static refError(err: any): string {
    const missing: string | undefined = err?.missingRef;
    if (typeof missing === "string") {
      if (SiloRef.isLocal(missing)) {
        const name = SiloRef.collectionOf(missing);
        return `$ref to unknown collection "${name}" (${missing})`;
      }
      if (/^https?:\/\//.test(missing)) {
        return `remote $ref "${missing}" is disabled; set [schema] allow_remote_refs = true (or SILO_SCHEMA_ALLOW_REMOTE_REFS=true) to fetch remote schemas during validation`;
      }
      return `unresolvable $ref "${missing}"`;
    }
    return err?.message || String(err);
  }
}
