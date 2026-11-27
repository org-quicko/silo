/**
 * Partial update payload for an entry via [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
 * JSON Merge Patch.
 *
 * Omitted keys keep their stored values (including `{{NAME}}` variables and
 * `silo://media/<id>` references), nested objects merge recursively, arrays
 * replace whole, and `null` deletes a member.
 */
export type EntryPatch<Fields = Record<string, unknown>> =
  string extends keyof Fields
    ? Record<string, unknown>
    : {
        [Key in keyof Fields]?: EntryPatchValue<Fields[Key]>;
      };

type EntryPatchObject<Value> =
  string extends keyof Value
    ? Record<string, unknown>
    : {
        [Key in keyof Value]?: EntryPatchValue<Value[Key]>;
      };

type EntryPatchValue<Value> = Value extends null | undefined
  ? null
  : Value extends readonly unknown[]
    ? Value | null
    : Value extends object
      ? EntryPatchObject<Value> | null
      : Value | null;
