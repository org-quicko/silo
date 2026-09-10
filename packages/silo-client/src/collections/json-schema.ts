/** A JSON Schema document, loosely typed: this client validates nothing
 *  locally and passes a schema through to the server exactly as given. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  [keyword: string]: unknown;
}
