import { describe, expect, test } from "bun:test";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { ManifestReader } from "../../src/plugins/manifest/manifest-reader";
import { PluginGrantResolver } from "../../src/plugins/registry/plugin-grant-resolver";

describe("the first-party observability package", () => {
  test("its checked-in manifest is accepted by the real host", async () => {
    const plugins = path.resolve(import.meta.dir, "../../../../plugins");
    const resolved = await ManifestReader.read(plugins, "silo-plugin-observability");
    expect(resolved.manifest.contributes.ui?.title).toBe("Observability");
    expect(resolved.manifest.contributes.routes).toHaveLength(1);

    const request = PluginGrantResolver.request(resolved.manifest);
    expect(request.required).toEqual([Claims.HttpRoute, Claims.ObservabilityRead].sort());
    expect(request.reasons[Claims.ObservabilityRead]).toContain("bounded aggregate");
  });
});
