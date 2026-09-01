import crypto from "crypto";
import { KeyFormat } from "@silo/shared/key-format";
import { Claims } from "@silo/shared/claims";
import type { ClaimPreset } from "@silo/shared/claim-preset";
import { ValidationError } from "@silo/shared/validation-error";
import { SystemCollections } from "../domain/system-collections";
import type { KeyInfo } from "./key-info";
import type { KeyMintOptions } from "./key-mint-options";

export class KeyUtils {
  static readonly KeysCollection = SystemCollections.Keys;

  static parsePreset(value: string): ClaimPreset {
    if (Claims.isPreset(value)) return value;
    throw new ValidationError(`unknown preset "${value}" (want root, manage, write or read)`);
  }

  static generateKey(
    label: string,
    claims: string[],
    options: KeyMintOptions = {}
  ): { secret: string; info: KeyInfo } {
    const secret = KeyFormat.Prefix + crypto.randomBytes(32).toString("base64url");
    const info: KeyInfo = {
      label,
      claims: Claims.normalize(claims),
      hash: KeyUtils.hashKey(secret),
      prefix: KeyFormat.displayPrefix(secret),
      // Spread rather than always-present, so an ordinary key's stored shape is
      // byte-for-byte what it was before D34/D38 and nothing needs backfilling.
      ...(options.owner ? { owner: options.owner } : {}),
      ...(options.parentId ? { parent_id: options.parentId } : {}),
    };
    return { secret, info };
  }

  /** Whether silo minted this key for a plugin and keeps its secret (D34).
   *  Managed keys are refused by the ordinary revoke path and left out of
   *  archives — a credential whose owning plugin is not there to bound it. */
  static isManaged(info: Pick<KeyInfo, "owner">): boolean {
    return info.owner !== undefined;
  }

  static hashKey(secret: string): string {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

}
