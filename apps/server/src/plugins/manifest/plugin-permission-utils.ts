import type { PluginPermission } from "./plugin-permission";
import type { PluginPermissions } from "./plugin-permissions";

/** Reading a `permissions` block: the claim lists, and the reasons behind them. */
export class PluginPermissionUtils {
  /** Every claim asked for, required first. Order is the manifest's, which is the
   *  order a grant screen reads them in. */
  static claims(permissions: PluginPermissions): string[] {
    return PluginPermissionUtils.all(permissions).map((each) => each.claim);
  }

  static requiredClaims(permissions: PluginPermissions): string[] {
    return permissions.required.map((each) => each.claim);
  }

  /** Claim to reason, for every declared permission. */
  static reasons(permissions: PluginPermissions): Record<string, string> {
    const reasons: Record<string, string> = {};
    for (const each of PluginPermissionUtils.all(permissions)) {
      if (reasons[each.claim] === undefined) reasons[each.claim] = each.reason;
    }
    return reasons;
  }

  static all(permissions: PluginPermissions): PluginPermission[] {
    return [...permissions.required, ...permissions.optional];
  }
}
