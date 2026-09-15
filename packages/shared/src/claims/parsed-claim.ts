import { ClaimSegment } from "./claim-segment";
import type { HookName } from "../hooks/hook-name";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";

export class ParsedClaim {
  readonly kind: "root" | "fixed" | "collection" | "hook";
  readonly raw: string;
  readonly fixed?: FixedClaim;
  readonly project?: string;
  readonly env?: string;
  readonly name?: string;
  readonly permission?: CollectionPermission;
  readonly hook?: HookName;

  private constructor(
    kind: "root" | "fixed" | "collection" | "hook",
    raw: string,
    options: {
      fixed?: FixedClaim;
      project?: string;
      env?: string;
      name?: string;
      permission?: CollectionPermission;
      hook?: HookName;
    } = {}
  ) {
    this.kind = kind;
    this.raw = raw;
    this.fixed = options.fixed;
    this.project = options.project;
    this.env = options.env;
    this.name = options.name;
    this.permission = options.permission;
    this.hook = options.hook;
  }

  static root(): ParsedClaim {
    return new ParsedClaim("root", "*");
  }

  static fromFixed(claim: FixedClaim): ParsedClaim {
    return new ParsedClaim("fixed", claim, { fixed: claim });
  }

  static fromCollection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission
  ): ParsedClaim {
    const raw = `collections:${project}/${env}/${name}:${permission}`;
    return new ParsedClaim("collection", raw, { project, env, name, permission });
  }

  /** Hook *delivery* over a collection (D34) — a separate authority from any
   *  `entries:*` permission, and never satisfied by one. */
  static fromHook(
    project: string,
    env: string,
    name: string,
    hook: HookName
  ): ParsedClaim {
    const raw = `hooks:${project}/${env}/${name}:${hook}`;
    return new ParsedClaim("hook", raw, { project, env, name, hook });
  }

  covers(required: ParsedClaim): boolean {
    if (this.kind === "root") return true;
    if (this.kind === "fixed") {
      return required.kind === "fixed" && this.fixed === required.fixed;
    }
    if (this.kind === "collection") {
      if (required.kind !== "collection") return false;
      if (this.permission !== required.permission) return false;
      return this.coversScope(required);
    }
    if (this.kind === "hook") {
      // Only another hook claim, never a collection one: reading entries and
      // being handed every write before it is validated are different powers,
      // and the wider-looking claim is the collection one.
      if (required.kind !== "hook") return false;
      if (this.hook !== required.hook) return false;
      return this.coversScope(required);
    }
    return false;
  }

  matchesScope(project: string, env: string): boolean {
    if (this.kind === "root") return true;
    if (this.kind === "collection" || this.kind === "hook") {
      return (
        ClaimSegment.matches(this.project!, project) && ClaimSegment.matches(this.env!, env)
      );
    }
    return false;
  }

  /** The three scope segments, each answered by `ClaimSegment` so that this
   *  and the search plan cannot drift apart. Shared by the two scoped kinds so
   *  they cannot drift apart from each other either. */
  private coversScope(required: ParsedClaim): boolean {
    return (
      ClaimSegment.covers(this.project!, required.project!) &&
      ClaimSegment.covers(this.env!, required.env!) &&
      ClaimSegment.covers(this.name!, required.name!)
    );
  }
}
