import { describe, expect, test } from "bun:test";
import { ValidationError } from "@silo/shared/validation-error";
import { PgErrorMap } from "../../src/adapters/storage/postgres/pg-error-map";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";

/** An error shaped the way Bun's driver shapes one: its label in `code`, the SQLSTATE in `errno`. */
function driverError(message: string, code: string, errno?: string): Error {
  return Object.assign(new Error(message), { code, errno });
}

const server = (message: string, errno: string) =>
  driverError(message, "ERR_POSTGRES_SERVER_ERROR", errno);

describe("PgErrorMap", () => {
  test("a unique violation is a conflict", () => {
    expect(PgErrorMap.translate(server("duplicate key", "23505"))).toBeInstanceOf(ConflictError);
  });

  test("a foreign key says not found on insert and conflict on delete", () => {
    const insert = server('insert or update on table "entries" violates foreign key', "23503");
    const remove = server('update or delete on table "collections" violates foreign key', "23503");
    expect(PgErrorMap.translate(insert)).toBeInstanceOf(NotFoundError);
    expect(PgErrorMap.translate(remove)).toBeInstanceOf(ConflictError);
  });

  test("a NUL the server cannot hold is the caller's error", () => {
    const translated = PgErrorMap.translate(server("invalid byte sequence", "22021"));
    expect(ValidationError.is(translated)).toBe(true);
  });

  test("timeouts, a full server and lost connections are a retryable 503", () => {
    for (const errno of ["57014", "53300", "57P01", "08006", "40001", "40P01"]) {
      expect(PgErrorMap.translate(server("not now", errno))).toBeInstanceOf(StorageBusyError);
    }
    const closed = driverError("Connection closed", "ERR_POSTGRES_CONNECTION_CLOSED");
    expect(PgErrorMap.translate(closed)).toBeInstanceOf(StorageBusyError);
  });

  test("anything else passes through unchanged, so a bug in the SQL stays a 500", () => {
    const syntax = server("syntax error", "42601");
    expect(PgErrorMap.translate(syntax)).toBe(syntax);
    const ours = new ConflictError("rev mismatch");
    expect(PgErrorMap.translate(ours)).toBe(ours);
    expect(PgErrorMap.translate("text")).toBe("text");
  });
});
