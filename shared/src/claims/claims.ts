import { ValidationError } from "../errors/validation-error";
import type { Claim } from "./claim";
import type { ClaimPreset } from "./claim-preset";
import type { CollectionClaim } from "./collection-claim";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";
import { ParsedClaim } from "./parsed-claim";

export class Claims {
  static readonly Root = "*";

  static readonly CollectionCreate = "create";
  static readonly CollectionDelete = "delete";
  static readonly CollectionSchemaRead = "schema:read";
  static readonly CollectionSchemaUpdate = "schema:update";
  static readonly CollectionAccessUpdate = "access:update";
  static readonly CollectionEntriesCreate = "entries:create";
  static readonly CollectionEntriesRead = "entries:read";
  static readonly CollectionEntriesUpdate = "entries:update";
  static readonly CollectionEntriesDelete = "entries:delete";

  static readonly KeysRead = "keys:read";
  static readonly KeysCreate = "keys:create";
  static readonly KeysRevoke = "keys:revoke";
  static readonly KeysExport = "keys:export";
  static readonly KeysImport = "keys:import";
  static readonly TransferExport = "transfer:export";
  static readonly TransferImport = "transfer:import";
  static readonly TransferCopy = "transfer:copy";
  static readonly MediaRead = "media:read";
  static readonly MediaCreate = "media:create";
  static readonly MediaDelete = "media:delete";

  private static readonly idSegment = "[a-z][a-z0-9_-]{0,63}";
  private static readonly collectionNamePattern = new RegExp(`^${Claims.idSegment}$`);
  private static readonly collectionClaimPattern = new RegExp(
    `^collections:(\\*|${Claims.idSegment})\\/(\\*|${Claims.idSegment})\\/(\\*|${Claims.idSegment}):(.+)$`,
  );

  // These lookup tables are `Record<Union, true>` rather than sets so the
  // compiler enforces that they stay *complete*: adding a member to one of the
  // unions without listing it here is an error, instead of a claim that
  // typechecks everywhere and is then rejected at runtime by `normalize`.
  // Read them only through `Object.hasOwn`, never `in` — inherited keys like
  // "constructor" must not validate.
  private static readonly collectionPermissions: Record<CollectionPermission, true> = {
    [Claims.CollectionCreate]: true,
    [Claims.CollectionDelete]: true,
    [Claims.CollectionSchemaRead]: true,
    [Claims.CollectionSchemaUpdate]: true,
    [Claims.CollectionAccessUpdate]: true,
    [Claims.CollectionEntriesCreate]: true,
    [Claims.CollectionEntriesRead]: true,
    [Claims.CollectionEntriesUpdate]: true,
    [Claims.CollectionEntriesDelete]: true,
  };
  private static readonly fixedClaims: Record<FixedClaim, true> = {
    [Claims.KeysRead]: true,
    [Claims.KeysCreate]: true,
    [Claims.KeysRevoke]: true,
    [Claims.KeysExport]: true,
    [Claims.KeysImport]: true,
    [Claims.TransferExport]: true,
    [Claims.TransferImport]: true,
    [Claims.TransferCopy]: true,
    [Claims.MediaRead]: true,
    [Claims.MediaCreate]: true,
    [Claims.MediaDelete]: true,
  };
  private static readonly presets: Record<ClaimPreset, true> = {
    read: true,
    write: true,
    root: true,
  };

  /**
   * Collection permissions an instance-wide transfer exercises.
   *
   * An export or import archive spans every project and environment at once,
   * and the `transfer:*` claims are fixed — they carry no scope of their own.
   * Holding one is therefore necessary but not sufficient: the caller must
   * also hold these permissions at `*` / `*` / `*`, which is exactly the
   * authority the archive confers. Without that, `transfer:export` would let
   * a key confined to one project read every other one. Defined here so the
   * route guard and the UI's affordances can't disagree about the rule.
   */
  static readonly TransferReadPermissions: readonly CollectionPermission[] = [
    Claims.CollectionSchemaRead,
    Claims.CollectionEntriesRead,
  ];

  /** Add, overwrite, and — in `replace` mode — delete entries in any scope. */
  static readonly TransferWritePermissions: readonly CollectionPermission[] = [
    Claims.CollectionEntriesCreate,
    Claims.CollectionEntriesUpdate,
    Claims.CollectionEntriesDelete,
  ];

  /** Every one of `permissions` held at `*` / `*` / `*`. */
  static hasInstanceWide(
    claims: readonly string[] | readonly ParsedClaim[],
    permissions: readonly CollectionPermission[],
  ): boolean {
    return permissions.every((permission) =>
      Claims.has(claims, Claims.collection("*", "*", "*", permission)),
    );
  }

  static collection(
    project: string,
    env: string,
    name: string,
    permission: CollectionPermission,
  ): CollectionClaim {
    return `collections:${project}/${env}/${name}:${permission}`;
  }

  static isCollectionName(name: string): boolean {
    return Claims.collectionNamePattern.test(name);
  }

  /**
   * Project and env ids use the same grammar as collection names — since D19
   * they are literal segments of a collection claim, so the pattern that
   * validates the claim validates them too. The server's `Scope` value object
   * keeps its own copy as the authority at the storage boundary; this exists
   * so the UI can reject a bad id before issuing a request rather than
   * restating the regex a third time.
   */
  static isScopeId(id: string): boolean {
    return Claims.collectionNamePattern.test(id);
  }

  static parse(claim: string): ParsedClaim {
    if (claim === Claims.Root) return ParsedClaim.root();
    if (Object.hasOwn(Claims.fixedClaims, claim)) {
      return ParsedClaim.fromFixed(claim as FixedClaim);
    }
    const match = Claims.collectionClaimPattern.exec(claim);
    if (match !== null && Object.hasOwn(Claims.collectionPermissions, match[4])) {
      return ParsedClaim.fromCollection(
        match[1],
        match[2],
        match[3],
        match[4] as CollectionPermission,
      );
    }
    throw new ValidationError(`unknown or invalid claim "${claim}"`);
  }

  static normalize(value: unknown): Claim[] {
    if (!Array.isArray(value)) {
      throw new ValidationError("claims must be an array of strings");
    }
    const claims = new Set<Claim>();
    for (const raw of value) {
      if (typeof raw !== "string" || !Claims.isValid(raw)) {
        throw new ValidationError(`unknown or invalid claim "${String(raw)}"`);
      }
      claims.add(raw);
    }
    if (claims.has(Claims.Root)) return [Claims.Root];
    return [...claims].sort();
  }

  static isValid(claim: string): claim is Claim {
    if (claim === Claims.Root || Object.hasOwn(Claims.fixedClaims, claim)) return true;
    const match = Claims.collectionClaimPattern.exec(claim);
    return match !== null && Object.hasOwn(Claims.collectionPermissions, match[4]);
  }

  static isPreset(value: string): value is ClaimPreset {
    return Object.hasOwn(Claims.presets, value);
  }

  static has(
    claims: readonly string[] | readonly ParsedClaim[],
    required: Claim | ParsedClaim,
  ): boolean {
    for (const c of claims) {
      if (typeof c === "string" && c === Claims.Root) return true;
      if (typeof c !== "string" && c.kind === "root") return true;
    }
    let req: ParsedClaim;
    try {
      req = typeof required === "string" ? Claims.parse(required) : required;
    } catch {
      return false;
    }
    for (const c of claims) {
      try {
        const held = typeof c === "string" ? Claims.parse(c) : c;
        if (held.covers(req)) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  static any(
    claims: readonly string[] | readonly ParsedClaim[],
    required: readonly (Claim | ParsedClaim)[],
  ): boolean {
    return required.some((claim) => Claims.has(claims, claim));
  }

  static hasAnyCollectionPermission(
    claims: readonly string[] | readonly ParsedClaim[],
    permission: CollectionPermission,
    project?: string,
    env?: string,
  ): boolean {
    for (const c of claims) {
      if (typeof c === "string" && c === Claims.Root) return true;
      if (typeof c !== "string" && c.kind === "root") return true;
      try {
        const held = typeof c === "string" ? Claims.parse(c) : c;
        if (held.kind === "collection" && held.permission === permission) {
          if (project !== undefined && env !== undefined) {
            if (held.matchesScope(project, env)) return true;
          } else {
            return true;
          }
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  static canDelegate(
    own: readonly string[] | readonly ParsedClaim[],
    requested: readonly (Claim | ParsedClaim)[],
  ): boolean {
    for (const c of own) {
      if (typeof c === "string" && c === Claims.Root) return true;
      if (typeof c !== "string" && c.kind === "root") return true;
    }
    const ownParsed: ParsedClaim[] = [];
    for (const c of own) {
      try {
        ownParsed.push(typeof c === "string" ? Claims.parse(c) : c);
      } catch {
        continue;
      }
    }
    return requested.every((req) => {
      try {
        const reqParsed = typeof req === "string" ? Claims.parse(req) : req;
        return ownParsed.some((held) => held.covers(reqParsed));
      } catch {
        return false;
      }
    });
  }

  static fromPreset(
    preset: ClaimPreset,
    targets: readonly string[] = [Claims.Root],
  ): Claim[] {
    if (preset === "root") return [Claims.Root];
    if (preset !== "write" && preset !== "read") {
      // Compile-time guard: a new ClaimPreset must decide what it grants here
      // rather than silently inheriting the "read" shape below.
      const unhandled: never = preset;
      throw new ValidationError(`unhandled preset "${String(unhandled)}"`);
    }
    const claims: Claim[] = [Claims.MediaRead];
    if (preset === "write") claims.push(Claims.MediaCreate, Claims.MediaDelete);
    for (const target of targets) {
      let p = "*";
      let e = "*";
      let n = "*";
      if (target === Claims.Root || target === "*/*/*") {
        p = "*";
        e = "*";
        n = "*";
      } else if (target.includes("/")) {
        const parts = target.split("/");
        if (parts.length === 3) {
          p = parts[0];
          e = parts[1];
          n = parts[2];
        } else if (parts.length === 2) {
          p = parts[0];
          e = parts[1];
          n = "*";
        } else {
          throw new ValidationError(
            `invalid target "${target}": want project/env/collection, project/env, or *`,
          );
        }
      } else {
        n = target;
      }
      claims.push(
        Claims.collection(p, e, n, Claims.CollectionSchemaRead),
        Claims.collection(p, e, n, Claims.CollectionEntriesRead),
      );
      if (preset === "write") {
        claims.push(
          Claims.collection(p, e, n, Claims.CollectionEntriesCreate),
          Claims.collection(p, e, n, Claims.CollectionEntriesUpdate),
          Claims.collection(p, e, n, Claims.CollectionEntriesDelete),
        );
      }
    }
    return Claims.normalize(claims);
  }

  static label(claims: readonly string[]): string {
    if (claims.includes(Claims.Root)) return "root access";
    return `${claims.length} claim${claims.length === 1 ? "" : "s"}`;
  }
}
