import { describe, expect, test } from "bun:test";
import { EnvironmentHandle } from "../../src/scope/environment-handle";
import { ProjectHandle } from "../../src/scope/project-handle";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const handleOf = (stubFetch: StubFetch): ProjectHandle => {
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return new ProjectHandle(transport, "acme");
};

describe("ProjectHandle", () => {
  test("environment() builds a handle with no request", () => {
    const stubFetch = new StubFetch();
    const environment = handleOf(stubFetch).environment("prod");

    expect(environment).toBeInstanceOf(EnvironmentHandle);
    expect(environment.name).toBe("prod");
    expect(stubFetch.received).toHaveLength(0);
  });

  test("rename() PATCHes with the new name, and a dry run's id feeds the real call as ?expected_id=", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ id: "01J8", from: "acme", to: "acme-corp", rewritten_claims: [], pattern_affected_claims: [] }),
    );
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        from: "acme",
        to: "acme-corp",
        rewritten_claims: ["collections:acme/*/*:*"],
        pattern_affected_claims: [],
      }),
    );
    const acme = handleOf(stubFetch);

    const preview = await acme.rename("acme-corp", { dryRun: true });
    expect(stubFetch.received[0].method).toBe("PATCH");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme?dry_run=true");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ name: "acme-corp" });

    const report = await acme.rename("acme-corp", { expectedId: preview.id });
    expect(new URL(stubFetch.received[1].url).searchParams.get("expected_id")).toBe("01J8");
    expect(report.rewrittenClaims).toEqual(["collections:acme/*/*:*"]);
  });

  test("delete() sends ?force=true only when asked", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());
    const acme = handleOf(stubFetch);

    await acme.delete({ force: true });

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme?force=true");
  });
});
