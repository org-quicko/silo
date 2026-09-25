import { describe, expect, test } from "bun:test";
import { ConfigSections } from "../../src/config/config-sections";
import { ConfigSecrets } from "../../src/settings/config-secrets";

const storage = ConfigSections.find("storage")!;

describe("ConfigSecrets", () => {
  test("a URL keeps its host, port, database and user, and loses its password", () => {
    expect(ConfigSecrets.mask("postgres://silo:hunter2@db.internal:5432/silo")).toBe(
      "postgres://silo:*****@db.internal:5432/silo"
    );
  });

  test("a credential in the query string is masked too, and other parameters are kept", () => {
    expect(ConfigSecrets.mask("postgres://db/silo?sslmode=require&password=x&api_key=y")).toBe(
      "postgres://db/silo?sslmode=require&password=*****&api_key=*****"
    );
  });

  test("a URL with no credentials is left as it is", () => {
    expect(ConfigSecrets.mask("postgres://db.internal/silo")).toBe("postgres://db.internal/silo");
  });

  test("a value that is not a URL is masked whole", () => {
    expect(ConfigSecrets.mask("host=db password=hunter2")).toBe(ConfigSecrets.Mask);
  });

  test("only secret fields are touched, and an absent one stays absent", () => {
    const values = { driver: "postgres", path: "/srv/silo", url: "postgres://u:p@db/silo" };
    expect(ConfigSecrets.redact(storage, values)).toEqual({
      driver: "postgres",
      path: "/srv/silo",
      url: "postgres://u:*****@db/silo",
    });
    expect(ConfigSecrets.redact(storage, { driver: "sqlite" })).toEqual({ driver: "sqlite" });
  });
});
