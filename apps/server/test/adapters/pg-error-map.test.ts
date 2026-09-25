import { describe, expect, test } from "bun:test";
import { ValidationError } from "@silo/shared/validation-error";
import { PgErrorMap } from "../../src/adapters/storage/postgres/pg-error-map";
import { PgUnavailableError } from "../../src/adapters/storage/postgres/pg-unavailable-error";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";

/** An error shaped the way Bun's driver shapes one: its label in `code`, the SQLSTATE in `errno`. */
function driverError(message: string, code: string, errno?: string): Error {
  return Object.assign(new Error(message), { code, errno });
}

const server = (message: string, errno: string) =>
  driverError(message, "ERR_POSTGRES_SERVER_ERROR", errno);

/** The failure a translated error carries, or null when it is not unavailable. */
const failureOf = (error: unknown) =>
  error instanceof PgUnavailableError ? error.failure : null;

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

  test("everything that means 'not now' is a 503, labelled with what may be done about it", () => {
    const cases: [Error, PgUnavailableError["failure"]][] = [
      [server("canceling statement due to statement timeout", "57014"), "busy"],
      [server("too many connections", "53300"), "busy"],
      [server("terminating connection due to administrator command", "57P01"), "connection"],
      [server("connection failure", "08006"), "connection"],
      [server("the database system is starting up", "57P03"), "unreachable"],
      [server("could not serialize access", "40001"), "contention"],
      [server("deadlock detected", "40P01"), "contention"],
      [driverError("Connection closed", "ERR_POSTGRES_CONNECTION_CLOSED"), "connection"],
      // What a statement inside a transaction sees when its backend is killed.
      [driverError("Failed to read data", "ERR_POSTGRES_EXPECTED_REQUEST"), "connection"],
      [driverError("Failed to connect", "ERR_POSTGRES_CONNECTION_REFUSED"), "unreachable"],
    ];
    for (const [error, failure] of cases) {
      const translated = PgErrorMap.translate(error);
      expect(translated).toBeInstanceOf(StorageBusyError);
      expect(failureOf(translated)).toBe(failure);
    }
  });

  test("a wrong password or a missing database stays itself, so a start fails at once", () => {
    const password = server("password authentication failed", "28P01");
    const database = server('database "x" does not exist', "3D000");
    expect(PgErrorMap.translate(password)).toBe(password);
    expect(PgErrorMap.translate(database)).toBe(database);
  });

  test("anything else passes through unchanged, so a bug in the SQL stays a 500", () => {
    const syntax = server("syntax error", "42601");
    expect(PgErrorMap.translate(syntax)).toBe(syntax);
    const ours = new ConflictError("rev mismatch");
    expect(PgErrorMap.translate(ours)).toBe(ours);
    expect(PgErrorMap.translate("text")).toBe("text");
  });
});
