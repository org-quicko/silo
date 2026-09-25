import type { ConfigSection } from "../config/config-section";

/**
 * Secret settings as the settings API reports them: never in full.
 *
 * A URL keeps everything but its credentials — which host, which database,
 * which user — because that is what an operator reading the page needs, and a
 * password in an admin session is one more place for it to leak from. Anything
 * that is not a URL is masked whole.
 */
export class ConfigSecrets {
  static readonly Mask = "*****";

  /** Query parameters a connection string may carry a credential in. */
  private static readonly SecretParameter = /pass|secret|token|key/i;

  static redact(section: ConfigSection, values: Record<string, unknown>): Record<string, unknown> {
    const secrets = section.fields.filter((field) => field.secret && values[field.key] !== undefined);
    if (secrets.length === 0) return values;

    const redacted = { ...values };
    for (const field of secrets) redacted[field.key] = ConfigSecrets.mask(redacted[field.key]);
    return redacted;
  }

  static mask(value: unknown): unknown {
    if (typeof value !== "string" || value === "") return value;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return ConfigSecrets.Mask;
    }
    if (url.password) url.password = ConfigSecrets.Mask;
    for (const name of [...url.searchParams.keys()]) {
      if (ConfigSecrets.SecretParameter.test(name)) url.searchParams.set(name, ConfigSecrets.Mask);
    }
    return url.toString();
  }
}
