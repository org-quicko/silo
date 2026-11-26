import openApiSpec from "../../../../resources/openapi.json";

/**
 * Serves the checked-in `resources/openapi.json` document from memory.
 *
 * Importing the JSON directly lets source runs, `bun test` from any working
 * directory, and `bun build --compile` binaries all serve the exact same spec
 * without reading from disk per request.
 */
export class OpenApiDocument {
  private static readonly serialized = `${JSON.stringify(openApiSpec, null, 4)}\n`;

  /** Pre-serialized OpenAPI 3.1 JSON string. */
  static json(): string {
    return OpenApiDocument.serialized;
  }
}
