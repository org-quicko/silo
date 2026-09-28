import { SQL } from "bun";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * A Postgres of the tests' own that accepts only TLS, for `postgres-tls.test.ts`.
 *
 * Built from nothing each run — a CA, a second CA the server does not use, a
 * server certificate naming `localhost` alone (so `127.0.0.1` is a host name
 * mismatch) and a client certificate — then a fresh cluster on a free port that
 * refuses plain text and logs `silo_cert` in by its certificate. `stop` removes
 * all of it. Needs `initdb` and `openssl`: `SILO_TEST_PG_BIN` names the
 * directory holding `initdb` and `pg_ctl`, or they are found on the `PATH`.
 */
export class PgTlsServer {
  readonly port: number;
  private readonly dir: string;
  private readonly pgCtl: string;

  private constructor(port: number, dir: string, pgCtl: string) {
    this.port = port;
    this.dir = dir;
    this.pgCtl = pgCtl;
  }

  /** Starts one, or answers why it cannot. */
  static async start(): Promise<PgTlsServer | string> {
    const bin = process.env.SILO_TEST_PG_BIN;
    const exe = process.platform === "win32" ? ".exe" : "";
    const initdb = bin ? path.join(bin, `initdb${exe}`) : Bun.which("initdb");
    const openssl = Bun.which("openssl");
    if (!initdb || !fs.existsSync(initdb)) return "initdb was not found (set SILO_TEST_PG_BIN)";
    if (!openssl) return "openssl was not found on the PATH";
    const pgCtl = path.join(path.dirname(initdb), `pg_ctl${exe}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "silo-pg-tls-"));
    try {
      await PgTlsServer.certificates(openssl, dir);
      const port = await PgTlsServer.freePort();
      const data = path.join(dir, "data");
      await PgTlsServer.run([initdb, "-D", data, "-U", "silo_tls", "--auth=trust", "-E", "UTF8", "--no-locale", "-N"]);
      PgTlsServer.configure(data, dir, port);
      // No pipes: the server pg_ctl starts would inherit them and hold them open.
      const started = Bun.spawn([pgCtl, "-D", data, "-l", path.join(dir, "pg.log"), "-w", "-t", "30", "start"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await started.exited) !== 0) {
        throw new Error(`pg_ctl start failed: ${fs.readFileSync(path.join(dir, "pg.log"), "utf8").slice(-800)}`);
      }
      const server = new PgTlsServer(port, dir, pgCtl);
      await server.admin(async (sql) => {
        await sql.unsafe(`CREATE ROLE silo_cert LOGIN`);
        await sql.unsafe(`GRANT CREATE ON DATABASE postgres TO silo_cert`);
      });
      return server;
    } catch (error) {
      await Bun.spawn([pgCtl, "-D", path.join(dir, "data"), "-m", "immediate", "-w", "stop"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      throw error;
    }
  }

  /** A URL to this server as `user`, reached by `host`, with `query` appended as it is. */
  url(options: { user?: string; host?: string; query?: string } = {}): string {
    const host = options.host ?? "localhost";
    return `postgres://${options.user ?? "silo_tls"}@${host}:${this.port}/postgres${options.query ?? ""}`;
  }

  /** A certificate or key, with forward slashes so it reads the same in a URL on every platform. */
  file(name: "ca.crt" | "rogue.crt" | "client.crt" | "client.key"): string {
    return path.join(this.dir, name).replaceAll("\\", "/");
  }

  /** A superuser connection over TLS, outside any store. */
  async admin<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
    const sql = new SQL({ url: this.url({ query: "?sslmode=require" }), max: 1, prepare: false });
    try {
      return await work(sql);
    } finally {
      await sql.close();
    }
  }

  /** Stops the server and removes everything it was built from. */
  async stop(): Promise<void> {
    await Bun.spawn([this.pgCtl, "-D", path.join(this.dir, "data"), "-m", "immediate", "-w", "stop"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  /** EC keys, since RSA generation is what would make this slow. */
  private static async certificates(openssl: string, dir: string): Promise<void> {
    const config = path.join(dir, "openssl.cnf");
    fs.writeFileSync(
      config,
      [
        "[req]",
        "distinguished_name = dn",
        "prompt = no",
        "[dn]",
        "CN = silo test",
        "[ca]",
        "basicConstraints = critical,CA:TRUE",
        "keyUsage = critical,keyCertSign,cRLSign",
        "subjectKeyIdentifier = hash",
        "[server]",
        "basicConstraints = CA:FALSE",
        "keyUsage = critical,digitalSignature",
        "extendedKeyUsage = serverAuth",
        "subjectAltName = DNS:localhost",
        "[client]",
        "basicConstraints = CA:FALSE",
        "keyUsage = critical,digitalSignature",
        "extendedKeyUsage = clientAuth",
        "",
      ].join("\n")
    );
    const at = (name: string) => path.join(dir, name);
    const key = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
    for (const [name, subject] of [["ca", "/CN=silo test ca"], ["rogue", "/CN=silo rogue ca"]]) {
      await PgTlsServer.run([openssl, "req", "-x509", "-config", config, "-extensions", "ca", ...key,
        "-days", "2", "-subj", subject, "-keyout", at(`${name}.key`), "-out", at(`${name}.crt`)]);
    }
    for (const [name, subject, extensions, serial] of [
      ["server", "/CN=localhost", "server", "2"],
      ["client", "/CN=silo_cert", "client", "3"],
    ]) {
      await PgTlsServer.run([openssl, "req", "-new", "-config", config, ...key, "-subj", subject,
        "-keyout", at(`${name}.key`), "-out", at(`${name}.csr`)]);
      await PgTlsServer.run([openssl, "x509", "-req", "-in", at(`${name}.csr`), "-CA", at("ca.crt"),
        "-CAkey", at("ca.key"), "-set_serial", serial, "-days", "2", "-extfile", config,
        "-extensions", extensions, "-out", at(`${name}.crt`)]);
    }
    // Postgres refuses a server key that others may read.
    fs.chmodSync(at("server.key"), 0o600);
  }

  private static configure(data: string, dir: string, port: number): void {
    const file = (name: string) => path.join(dir, name).replaceAll("\\", "/");
    fs.appendFileSync(
      path.join(data, "postgresql.conf"),
      [
        "",
        `port = ${port}`,
        "listen_addresses = '127.0.0.1,::1'",
        "unix_socket_directories = ''",
        "ssl = on",
        `ssl_cert_file = '${file("server.crt")}'`,
        `ssl_key_file = '${file("server.key")}'`,
        `ssl_ca_file = '${file("ca.crt")}'`,
        "fsync = off",
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(data, "pg_hba.conf"),
      [
        "hostssl all silo_cert all cert",
        "hostssl all all 127.0.0.1/32 trust",
        "hostssl all all ::1/128 trust",
        "hostnossl all all all reject",
        "",
      ].join("\n")
    );
  }

  private static async freePort(): Promise<number> {
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port;
    listener.stop(true);
    return port;
  }

  private static async run(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`${path.basename(command[0])} failed (${code}): ${stderr.slice(-800)}`);
  }
}
