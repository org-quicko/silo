import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";

export class ParsedClaim {
  readonly kind: "root" | "fixed" | "collection";
  readonly raw: string;
  readonly fixed?: FixedClaim;
  readonly project?: string;
  readonly env?: string;
  readonly name?: string;
  readonly permission?: CollectionPermission;

  private constructor(
    kind: "root" | "fixed" | "collection",
    raw: string,
    opts: {
      fixed?: FixedClaim;
      project?: string;
      env?: string;
      name?: string;
      permission?: CollectionPermission;
    } = {}
  ) {
    this.kind = kind;
    this.raw = raw;
    this.fixed = opts.fixed;
    this.project = opts.project;
    this.env = opts.env;
    this.name = opts.name;
    this.permission = opts.permission;
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

  covers(required: ParsedClaim): boolean {
    if (this.kind === "root") return true;
    if (this.kind === "fixed") {
      return required.kind === "fixed" && this.fixed === required.fixed;
    }
    if (this.kind === "collection") {
      if (required.kind !== "collection") return false;
      if (this.permission !== required.permission) return false;
      if (this.project !== "*" && this.project !== required.project) return false;
      if (this.env !== "*" && this.env !== required.env) return false;
      if (this.name !== "*" && this.name !== required.name) return false;
      return true;
    }
    return false;
  }

  matchesScope(project: string, env: string): boolean {
    if (this.kind === "root") return true;
    if (this.kind === "collection") {
      const matchProj = this.project === "*" || this.project === project;
      const matchEnv = this.env === "*" || this.env === env;
      return matchProj && matchEnv;
    }
    return false;
  }
}
