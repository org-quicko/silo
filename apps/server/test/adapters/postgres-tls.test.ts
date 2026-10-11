import { afterAll, describe, expect, test } from "bun:test";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import type { PgStoreOptions } from "../../src/adapters/storage/postgres/pg-store";
import type { Entry } from "../../src/core/domain/entry";
import { Scope } from "../../src/core/domain/scope";
import { AsyncChecks } from "./support/async-checks";
import { PgTestDatabase } from "./support/pg-test-database";
import { PgTlsServer } from "./support/pg-tls-server";

/**
 * The Postgres adapter over TLS (D96), against a TLS-only server the test
 * builds for itself (`PgTlsServer`), so it runs wherever `initdb` and
 * `openssl` do, with or without `SILO_TEST_PG_URL`. The one case that needs a
 * server without TLS uses `SILO_TEST_PG_URL` when that server has `ssl` off.
 */
const server = await PgTlsServer.start();
if (typeof server !== "string") afterAll(() => server.stop(), 30_000);

/** A store on a fresh schema; a refusal is expected to arrive long before `startupWait` would. */
function open(url: string, extra: Partial<PgStoreOptions> = {}): Promise<PgStore> {
  return PgStore.open({
    url,
    schema: PgTestDatabase.freshSchema(),
    applicationName: PgTestDatabase.freshApplicationName(),
    startupWait: 30,
    ...extra,
  });
}

/** The refusal, and how long it took to arrive. */
async function refusedQuickly(pending: Promise<unknown>): Promise<string> {
  const started = Date.now();
  const message = await AsyncChecks.refusal(pending);
  expect(Date.now() - started).toBeLessThan(5_000);
  return message;
}

if (typeof server === "string") {
  PgTestDatabase.skipping(server);
  describe.skip(`Postgres over TLS (${server})`, () => {
    test("verify-full, verify-ca, require, client certificates, refusals", () => {});
  });
} else {
  const ca = encodeURIComponent(server.file("ca.crt"));

  describe("PgStore over TLS", () => {
    test("verify-full: the pool and the owner lock are both encrypted, and the store reports it", async () => {
      const applicationName = PgTestDatabase.freshApplicationName();
      const store = await open(server.url({ query: `?sslmode=verify-full&sslrootcert=${ca}` }), {
        applicationName,
      });
      try {
        const now = new Date(Date.UTC(2026, 0, 1));
        const entry: Entry = {
          id: "tls",
          project: Scope.Default.project,
          env: Scope.Default.env,
          collection: "posts",
          rev: 1,
          seq: 0,
          created_at: now,
          updated_at: now,
          data: { title: "over TLS" },
        };
        await store.putSchema(Scope.Default, "posts", { type: "object" });
        await store.put(entry, { usages: [], search: null });
        expect((await store.get(Scope.Default, "posts", "tls")).data).toEqual({ title: "over TLS" });
        await store.claimOwnership();

        const sessions = await server.admin((sql) =>
          sql.unsafe(
            `SELECT a.application_name AS name, s.ssl FROM pg_stat_activity a JOIN pg_stat_ssl s USING (pid)
             WHERE a.application_name LIKE $1`,
            [`${applicationName}%`]
          )
        );
        expect(sessions.some((row: { name: string }) => row.name === `${applicationName} owner`)).toBe(true);
        expect(sessions.every((row: { ssl: boolean }) => row.ssl)).toBe(true);

        const measured = await store.measure();
        expect(measured.tls?.mode).toBe("verify-full");
        expect(measured.tls?.protocol).toMatch(/^TLSv1\.[23]$/);
      } finally {
        await store.close();
      }
    });

    test("a host name the certificate does not name is refused at once, and the message says so", async () => {
      const message = await refusedQuickly(
        open(server.url({ host: "127.0.0.1", query: `?sslmode=verify-full&sslrootcert=${ca}` }))
      );
      expect(message).toContain("certificate was not accepted");
      expect(message).toContain("does not name the host");
    });

    test("verify-ca checks the chain and not the name", async () => {
      const store = await open(server.url({ host: "127.0.0.1", query: `?sslmode=verify-ca&sslrootcert=${ca}` }));
      await store.close();
    });

    test("a CA that did not sign the server's certificate is refused", async () => {
      const rogue = encodeURIComponent(server.file("rogue.crt"));
      const message = await refusedQuickly(open(server.url({ query: `?sslmode=verify-full&sslrootcert=${rogue}` })));
      // OpenSSL's reason, which depends on the chain the server sends.
      expect(message).toMatch(/certificate was not accepted \((unable to verify|self.signed)/);
    });

    test("require encrypts without checking the certificate", async () => {
      const store = await open(server.url({ query: "?sslmode=require" }));
      try {
        const measured = await store.measure();
        expect(measured.tls?.mode).toBe("require");
        expect(measured.tls?.protocol).toMatch(/^TLSv1\.[23]$/);
      } finally {
        await store.close();
      }
    });

    test("a URL without sslmode is refused by a server that takes only TLS, naming sslmode", async () => {
      const message = await refusedQuickly(open(server.url()));
      expect(message).toContain("accepts only TLS connections");
      expect(message).toContain("sslmode");
    });

    test("a client certificate logs in as the role it names, and without one the server refuses", async () => {
      const cert = encodeURIComponent(server.file("client.crt"));
      const key = encodeURIComponent(server.file("client.key"));
      const store = await open(
        server.url({ user: "silo_cert", query: `?sslmode=verify-full&sslrootcert=${ca}&sslcert=${cert}&sslkey=${key}` })
      );
      await store.close();

      const message = await refusedQuickly(
        open(server.url({ user: "silo_cert", query: `?sslmode=verify-full&sslrootcert=${ca}` }))
      );
      expect(message).toContain("valid client certificate");
    });
  });

  const plain = PgTestDatabase.url();
  const plainHasNoTls =
    plain !== undefined &&
    (await PgTestDatabase.admin((sql) => sql.unsafe(`SHOW ssl`)))[0].ssl === "off";

  describe.skipIf(!plainHasNoTls)("PgStore asking TLS of a server without it", () => {
    test("require is refused at once, rather than waiting or falling back", async () => {
      const url = new URL(plain!);
      url.searchParams.set("sslmode", "require");
      const message = await refusedQuickly(open(url.toString()));
      expect(message).toContain("does not offer TLS");
      expect(message).toContain("sslmode=require");
    });
  });
}
