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

  test("a pool the driver broke is a lost connection, TLS or not, never a 500", () => {
    // A plain Error with no code, raised before anything is sent (oven-sh/bun#42804).
    const broken = new Error("connection must be a PostgresSQLConnection");
    expect(PgErrorMap.isBrokenPool(broken)).toBe(true);
    expect(failureOf(PgErrorMap.translate(broken))).toBe("connection");
    expect(failureOf(PgErrorMap.translate(broken, "verify-full"))).toBe("connection");
    expect(PgErrorMap.isBrokenPool(new Error("connection closed"))).toBe(false);
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

  test("a TLS disagreement is its own failure, naming what to change in the URL", () => {
    const missing = PgErrorMap.translate(
      driverError("Server does not support SSL", "ERR_POSTGRES_TLS_NOT_AVAILABLE"),
      "require"
    );
    expect(failureOf(missing)).toBe("tls");
    expect((missing as Error).message).toContain("does not offer TLS");
    expect((missing as Error).message).toContain("sslmode=require");

    const plain = PgErrorMap.translate(
      server('pg_hba.conf rejects connection for host "::1", user "silo", database "silo", no encryption', "28000")
    );
    expect(failureOf(plain)).toBe("tls");
    expect((plain as Error).message).toContain("accepts only TLS connections");
  });

  test("a certificate the handshake refused is a TLS failure, even when the driver gives no reason", () => {
    // Bun raises these as plain Errors: OpenSSL's code, or nothing at all for a host name mismatch.
    const untrusted = Object.assign(new Error("unable to verify the first certificate"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      errno: 0,
    });
    const blank = Object.assign(new Error(""), { errno: 0 });

    const translated = PgErrorMap.translate(untrusted, "verify-full");
    expect(failureOf(translated)).toBe("tls");
    expect((translated as Error).message).toContain("unable to verify the first certificate");
    expect((PgErrorMap.translate(blank, "verify-full") as Error).message).toContain(
      "does not name the host"
    );
    // With TLS off there is no handshake, so a blank error is not guessed to be one.
    expect(PgErrorMap.translate(blank)).toBe(blank);
  });

  test("a wrong client certificate is an authentication failure, and stays itself", () => {
    const refused = server("connection requires a valid client certificate", "28000");
    expect(PgErrorMap.translate(refused, "verify-full")).toBe(refused);
  });

  test("anything else passes through unchanged, so a bug in the SQL stays a 500", () => {
    const syntax = server("syntax error", "42601");
    expect(PgErrorMap.translate(syntax)).toBe(syntax);
    const ours = new ConflictError("rev mismatch");
    expect(PgErrorMap.translate(ours)).toBe(ours);
    expect(PgErrorMap.translate("text")).toBe("text");
  });
});
