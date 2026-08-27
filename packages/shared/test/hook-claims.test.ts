import { describe, test, expect } from "bun:test";
import { Claims } from "@silo/shared/claims";
import type { Claim } from "@silo/shared/claim";

/**
 * The third claim shape, `hooks:<project>/<env>/<collection>:<hook>` (D34).
 *
 * It exists because hook *delivery* was not claim-checked at all: a plugin
 * granted nothing could declare `entry.beforeValidate` and rewrite every entry
 * written to the instance. The tests that matter here are therefore the ones
 * about **separation** — that no collection permission satisfies a hook claim
 * and no hook claim satisfies a collection permission — because collapsing the
 * two is what would quietly hand that power back.
 */
describe("hook claims", () => {
  const beforeValidate = "entry.beforeValidate" as const;

  test("a hook claim is well formed only for a real hook name", () => {
    expect(Claims.isValid("hooks:acme/prod/posts:entry.beforeValidate")).toBe(true);
    expect(Claims.isValid("hooks:*/*/*:entry.afterWrite")).toBe(true);

    expect(Claims.isValid("hooks:acme/prod/posts:entry.whatever")).toBe(false);
    // No wildcard on the hook segment, for the reason D19 gives about action
    // wildcards: a grant names what it permits.
    expect(Claims.isValid("hooks:acme/prod/posts:*")).toBe(false);
    expect(Claims.isValid("hooks:acme/prod:entry.afterWrite")).toBe(false);
    expect(Claims.isValid("hooks:ACME/prod/posts:entry.afterWrite")).toBe(false);
  });

  test("scope segments wildcard independently, like a collection claim", () => {
    const held = ["hooks:acme/*/posts:entry.beforeValidate"] as Claim[];

    expect(Claims.canDeliver(held, "acme", "prod", "posts", beforeValidate)).toBe(true);
    expect(Claims.canDeliver(held, "acme", "dev", "posts", beforeValidate)).toBe(true);
    expect(Claims.canDeliver(held, "other", "prod", "posts", beforeValidate)).toBe(false);
    expect(Claims.canDeliver(held, "acme", "prod", "pages", beforeValidate)).toBe(false);
  });

  test("the hook segment never widens", () => {
    const held = ["hooks:*/*/*:entry.afterWrite"] as Claim[];

    expect(Claims.canDeliver(held, "acme", "prod", "posts", "entry.afterWrite")).toBe(true);
    expect(Claims.canDeliver(held, "acme", "prod", "posts", beforeValidate)).toBe(false);
    expect(Claims.canDeliver(held, "acme", "prod", "posts", "entry.beforeDelete")).toBe(false);
  });

  /**
   * The separation the whole shape exists for. Being handed every write before
   * it is validated is a larger authority than reading a committed one, so the
   * wider-looking claim must not imply the narrower-sounding one.
   */
  test("no collection permission satisfies a hook claim, in either direction", () => {
    const collectionWide = [
      "collections:*/*/*:entries:read",
      "collections:*/*/*:entries:update",
      "collections:*/*/*:entries:create",
      "collections:*/*/*:entries:delete",
      "collections:*/*/*:schema:update",
    ] as Claim[];
    expect(Claims.canDeliver(collectionWide, "acme", "prod", "posts", beforeValidate)).toBe(false);

    const hookWide = ["hooks:*/*/*:entry.beforeValidate"] as Claim[];
    expect(
      Claims.has(hookWide, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead)),
    ).toBe(false);
  });

  test("root covers hook claims, because root covers everything", () => {
    expect(Claims.canDeliver([Claims.Root], "acme", "prod", "posts", beforeValidate)).toBe(true);
  });

  test("delegation cannot widen a hook grant", () => {
    const own = ["hooks:acme/prod/posts:entry.afterWrite"] as Claim[];

    expect(Claims.canDelegate(own, ["hooks:acme/prod/posts:entry.afterWrite" as Claim])).toBe(true);
    expect(Claims.canDelegate(own, ["hooks:acme/*/posts:entry.afterWrite" as Claim])).toBe(false);
    expect(Claims.canDelegate(own, ["hooks:acme/prod/posts:entry.beforeWrite" as Claim])).toBe(false);
    // And a collection grant is not a licence to hand out delivery.
    expect(
      Claims.canDelegate(["collections:*/*/*:entries:update" as Claim], [
        "hooks:acme/prod/posts:entry.beforeValidate" as Claim,
      ]),
    ).toBe(false);
  });

  test("hook claims normalize alongside the other shapes", () => {
    expect(
      Claims.normalize([
        "hooks:acme/prod/posts:entry.afterWrite",
        "hooks:acme/prod/posts:entry.afterWrite",
        "collections:acme/prod/posts:entries:read",
      ]),
    ).toEqual(["collections:acme/prod/posts:entries:read", "hooks:acme/prod/posts:entry.afterWrite"]);

    expect(() => Claims.normalize(["hooks:acme/prod/posts:nope"])).toThrow(/invalid claim/);
  });

  test("holding only hook claims is no API access at all", () => {
    // A plugin that observes writes and calls nothing reports "none", which is
    // what the grant UI should show: delivery is not reach.
    expect(Claims.accessLevel(["hooks:*/*/*:entry.afterWrite"])).toBe("none");
  });
});

describe("plugin management claims", () => {
  test("they are ordinary fixed claims", () => {
    expect(Claims.isValid(Claims.PluginsRead)).toBe(true);
    expect(Claims.isValid(Claims.PluginsGrant)).toBe(true);
    expect(Claims.has([Claims.Root], Claims.PluginsGrant)).toBe(true);
    expect(Claims.has([Claims.PluginsRead], Claims.PluginsGrant)).toBe(false);
  });

  /**
   * Which preset carries what is a security decision, not a convenience one:
   * `canDelegate` means only a holder of `plugins:grant` can approve a plugin,
   * so keeping it out of `manage` is what makes empowering a plugin deliberate.
   */
  test("only root grants and enables plugins", () => {
    expect(Claims.presetFixedClaims("manage")).toContain(Claims.PluginsRead);
    expect(Claims.presetFixedClaims("manage")).toContain(Claims.PluginsConfigure);
    expect(Claims.presetFixedClaims("manage")).not.toContain(Claims.PluginsGrant);
    expect(Claims.presetFixedClaims("manage")).not.toContain(Claims.PluginsEnable);

    expect(Claims.presetFixedClaims("write")).not.toContain(Claims.PluginsRead);
    expect(Claims.presetFixedClaims("read")).not.toContain(Claims.PluginsRead);

    expect(Claims.presetFixedClaims("root")).toContain(Claims.PluginsGrant);
    expect(Claims.presetFixedClaims("root")).toContain(Claims.PluginsEnable);
  });
});

describe("the audit claim (D38)", () => {
  test("it is an ordinary fixed claim, and read-only by construction", () => {
    expect(Claims.isValid(Claims.AuditRead)).toBe(true);
    expect(Claims.has([Claims.Root], Claims.AuditRead)).toBe(true);
    expect(Claims.has([Claims.KeysRead], Claims.AuditRead)).toBe(false);

    // There is no `audit:write`, deliberately: nothing updates or deletes an
    // event, so a claim guarding that would imply a capability that does not
    // exist. Asserted so adding one is a decision rather than a reflex.
    expect(Claims.isValid("audit:write")).toBe(false);
  });

  /**
   * Reading the trail is an operator's job. Withholding it from the preset an
   * operator is given would leave the log to `root` alone — the account you
   * want people using least.
   */
  test("manage and root read the trail; write and read do not", () => {
    expect(Claims.presetFixedClaims("manage")).toContain(Claims.AuditRead);
    expect(Claims.presetFixedClaims("root")).toContain(Claims.AuditRead);
    expect(Claims.presetFixedClaims("write")).not.toContain(Claims.AuditRead);
    expect(Claims.presetFixedClaims("read")).not.toContain(Claims.AuditRead);
  });

  /**
   * The trail names every key and every claim ever granted here, which is
   * disclosure rather than escalation — the line D37 drew for `keys:read` and
   * `keys:export`. So a plugin may hold it, and that is a trade-off an operator
   * gets to make rather than one the vocabulary makes for them.
   */
  test("a plugin may be granted it, like the other disclosing claims", () => {
    expect(Claims.PluginForbiddenClaims).not.toContain(Claims.AuditRead);
  });
});
