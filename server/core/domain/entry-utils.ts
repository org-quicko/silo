import { ulid } from "ulidx";
import { ValidationError } from "@silo/shared/validation-error";
import { MediaResolver } from "../media/media-resolver";
import type { Entry } from "./entry";

export const TimeLayout = "YYYY-MM-DDTHH:mm:ss.SSSZ";

// Upper bound for a path segment, in BYTES: the fs adapter turns these into
// filenames and virtually every filesystem caps a name at 255 bytes. A looser
// cap would let a value through on SQLite that the fs adapter rejects with a
// raw ENAMETOOLONG mid-write — the exact cross-adapter divergence this
// contract exists to prevent. Collection names cap at 64 anyway (Claims
// grammar); ids are ULIDs (26 chars) going forward, but imported historical
// ids are deliberately NOT narrowed to that shape (D18/Importer) — this only
// guards against pathological/adversarial length, not format.
const MaxSegmentBytes = 255;

export class EntryUtils {
  static newID(): string {
    return ulid();
  }

  static now(): Date {
    return new Date();
  }

  static isSystemCollection(name: string): boolean {
    return name.length > 0 && name[0] === "_";
  }

  /**
   * Every storage adapter builds a path or a bound-parameter lookup out of
   * `collection`/`id` (and, on `put`, `project`/`env` read off the entry).
   * Both adapters must reject the same malformed values identically — this
   * is a `Storage` port contract, not one adapter's local defense — so an
   * import archive can't plant an entry outside its scope (fs) or hide a
   * divergence a future adapter would trust (`Storage.put`/`get`/`delete`/
   * `list` doc comment). Ids are intentionally NOT narrowed to ULID shape:
   * imported historical entries may carry arbitrary ids.
   */
  static assertSafeSegment(value: unknown, label: string): void {
    if (typeof value !== "string" || value.length === 0) {
      throw new ValidationError(`invalid ${label} ${JSON.stringify(value)}: must be a non-empty string`);
    }
    // Measured in bytes, not characters: the filesystem limit is bytes, so a
    // multi-byte unicode id that "fits" by length would still fail on write.
    if (Buffer.byteLength(value, "utf8") > MaxSegmentBytes) {
      throw new ValidationError(`invalid ${label}: too long (max ${MaxSegmentBytes} bytes)`);
    }
    if (value === "." || value === "..") {
      throw new ValidationError(`invalid ${label} "${value}": must not be "." or ".."`);
    }
    if (/[/\\\0]/.test(value)) {
      throw new ValidationError(`invalid ${label} "${value}": must not contain "/", "\\", or a NUL byte`);
    }
  }

  static toApiResponse(e: Entry, schema?: any, baseUrl?: string): Record<string, any> {
    const createdAt =
      e.created_at instanceof Date
        ? e.created_at.toISOString()
        : typeof e.created_at === "string"
        ? e.created_at
        : new Date(e.created_at).toISOString();
    const updatedAt =
      e.updated_at instanceof Date
        ? e.updated_at.toISOString()
        : typeof e.updated_at === "string"
        ? e.updated_at
        : new Date(e.updated_at).toISOString();

    let userFields =
      e.data && typeof e.data === "object" && !Array.isArray(e.data)
        ? { ...e.data }
        : {};
    delete userFields.id;
    delete userFields.rev;
    delete userFields.seq;
    delete userFields.created_at;
    delete userFields.updated_at;

    if (schema && baseUrl) {
      userFields = MediaResolver.resolveMediaFields(userFields, schema, baseUrl);
    }

    // `rev` is part of the response because `PUT`/`DELETE` require it back as
    // `If-Match`/`?rev=` (§8). Without it a client can only guess, which
    // works exactly once per entry and then 409s forever — the envelope's
    // other internals (`collection`, `seq`, scope) stay hidden.
    return {
      id: e.id,
      rev: e.rev,
      ...userFields,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }
}
