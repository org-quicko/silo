import { afterAll, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { PgTls } from "../../src/adapters/storage/postgres/pg-tls";

/**
 * How `[storage] url`'s TLS parameters are read (D96). No server here: the
 * handshake itself is `postgres-tls.test.ts`. The files only have to look like
 * PEM, since reading them is all `PgTls` does.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "silo-pg-tls-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function pem(name: string, label = "CERTIFICATE"): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `-----BEGIN ${label}-----\n${name}\n-----END ${label}-----\n`);
  return file.replaceAll("\\", "/");
}

const ca = pem("ca.crt");
const cert = pem("client.crt");
const key = pem("client.key", "PRIVATE KEY");
const base = "postgres://silo:secret@db.example.com:5432/silo";

function refusal(url: string): string {
  try {
    PgTls.of(url);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("PgTls", () => {
  test("no sslmode is disable, as the driver has it, and says so to the driver", () => {
    const tls = PgTls.of(base);
    expect(tls.mode).toBe("disable");
    expect(tls.url).toBe(`${base}?sslmode=disable`);
    expect(tls.files).toBeUndefined();
  });

  test("the modes the driver honours pass through, and other parameters keep their exact bytes", () => {
    for (const mode of ["disable", "require", "verify-ca", "verify-full"]) {
      const tls = PgTls.of(`${base}?application_name=a+b&options=-c%20search_path%3Dx&sslmode=${mode}`);
      expect(tls.mode).toBe(mode as typeof tls.mode);
      expect(tls.url).toBe(`${base}?application_name=a+b&options=-c%20search_path%3Dx&sslmode=${mode}`);
    }
  });

  test("prefer and allow are refused, naming the modes that work", () => {
    for (const mode of ["prefer", "allow"]) {
      const message = refusal(`${base}?sslmode=${mode}`);
      expect(message).toContain(`[storage] url: sslmode=${mode} is not supported`);
      expect(message).toContain("verify-full");
    }
    expect(refusal(`${base}?sslmode=on`)).toContain("sslmode=on is not a mode");
  });

  test("sslrootcert is read and taken out of the URL, since the server would refuse it as a parameter", () => {
    const tls = PgTls.of(`${base}?sslmode=verify-full&sslrootcert=${encodeURIComponent(ca)}`);
    expect(tls.mode).toBe("verify-full");
    expect(tls.url).toBe(`${base}?sslmode=verify-full`);
    expect(tls.files?.ca).toContain("ca.crt");
  });

  test("a CA with no mode means verify-full, and with require means verify-ca, as in libpq", () => {
    expect(PgTls.of(`${base}?sslrootcert=${ca}`).mode).toBe("verify-full");
    expect(PgTls.of(`${base}?sslmode=require&sslrootcert=${ca}`).mode).toBe("verify-ca");
  });

  test("sslrootcert=system uses the driver's own roots and needs verify-full", () => {
    const tls = PgTls.of(`${base}?sslrootcert=system`);
    expect(tls.mode).toBe("verify-full");
    expect(tls.files).toBeUndefined();
    expect(refusal(`${base}?sslmode=require&sslrootcert=system`)).toContain("needs sslmode=verify-full");
  });

  test("a client certificate needs its key, and alone turns TLS on without checking the server", () => {
    const tls = PgTls.of(`${base}?sslcert=${cert}&sslkey=${key}`);
    expect(tls.mode).toBe("require");
    expect(tls.files).toEqual({ cert: expect.stringContaining("client.crt"), key: expect.stringContaining("client.key") });
    expect(refusal(`${base}?sslcert=${cert}`)).toContain("give both");
    expect(refusal(`${base}?sslkey=${key}`)).toContain("give both");
  });

  test("certificates beside sslmode=disable are refused rather than ignored", () => {
    expect(refusal(`${base}?sslmode=disable&sslrootcert=${ca}`)).toContain("would be ignored");
  });

  test("a file that is missing or not PEM is refused, naming the parameter and the path", () => {
    expect(refusal(`${base}?sslrootcert=${dir}/nowhere.crt`)).toMatch(/sslrootcert=.*nowhere\.crt cannot be read \(ENOENT\)/);
    const der = path.join(dir, "ca.der");
    fs.writeFileSync(der, Buffer.from([0x30, 0x82, 0x01]));
    expect(refusal(`${base}?sslrootcert=${der}`)).toContain("is not a PEM file");
  });

  test("any other ssl parameter is refused, so nothing the URL asks for is silently dropped", () => {
    for (const name of ["sslpassword", "sslcrl", "sslnegotiation", "requiressl"]) {
      expect(refusal(`${base}?${name}=1`)).toBe(`[storage] url: ${name} is not supported`);
    }
  });

  test("a refusal never repeats a value it could not decode", () => {
    const message = refusal(`${base}?sslmode=%E0%A4%A`);
    expect(message).toBe("[storage] url: a query parameter is not valid percent-encoding");
  });
});
