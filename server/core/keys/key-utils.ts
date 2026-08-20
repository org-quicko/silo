import crypto from "crypto";
import { KeyFormat } from "@silo/shared/key-format";
import { Claims } from "@silo/shared/claims";
import type { ClaimPreset } from "@silo/shared/claim-preset";
import { ValidationError } from "@silo/shared/validation-error";
import type { KeyInfo } from "./key-info";

export class KeyUtils {
  static readonly KeysCollection = "_keys";

  static parsePreset(value: string): ClaimPreset {
    if (Claims.isPreset(value)) return value;
    throw new ValidationError(`unknown preset "${value}" (want root, manage, write or read)`);
  }

  static generateKey(label: string, claims: string[]): { secret: string; info: KeyInfo } {
    const secret = KeyFormat.Prefix + crypto.randomBytes(32).toString("base64url");
    const info: KeyInfo = {
      label,
      claims: Claims.normalize(claims),
      hash: KeyUtils.hashKey(secret),
      prefix: KeyFormat.displayPrefix(secret),
    };
    return { secret, info };
  }

  static hashKey(secret: string): string {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

}
