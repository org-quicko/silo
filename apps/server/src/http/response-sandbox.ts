/**
 * The two headers that keep bytes silo did not write from becoming a page on
 * silo's origin (D83).
 *
 * The API and the admin SPA share one origin, and the admin keeps an API key
 * for every configured server in that origin's `localStorage`. So any response
 * a browser would render as a document — an SVG with a `<script>` in it, a
 * plugin route answering HTML — is a way to read every one of those keys, and
 * the 2026-09-18 audit walked that path from a `write`-preset upload to root
 * (H1, H2). `nosniff` stops a browser guessing a type silo did not state, and a
 * `sandbox` policy gives whatever does render an opaque origin with no script,
 * so `localStorage` is out of reach even when the link is opened directly.
 *
 * Two policies, because the two surfaces render different things. Media may
 * legitimately be *looked at* — an SVG opened in a tab should still draw, a PDF
 * should still show — so `MediaPolicy` is `sandbox` alone. A plugin route is an
 * API answer and never a page, so `ApiPolicy` also blocks every resource load,
 * which is the policy `/api/plugins/{name}/ui` has carried since D41. Both were
 * measured on a Chromium browser before being chosen: a PDF renders under
 * `sandbox`, an `<img>` still draws an SVG served as an attachment, and a
 * navigated SVG's script does not run.
 */
export class ResponseSandbox {
  /** Opaque origin, no script; everything else the document asks for is allowed. */
  static readonly MediaPolicy = "sandbox";

  /** Opaque origin, no script, and no resource of any kind. */
  static readonly ApiPolicy = "default-src 'none'; sandbox";

  private static readonly Owned = ["x-content-type-options", "content-security-policy"];

  /**
   * The headers with silo's two set, whatever the caller had put under those
   * names. Case-insensitive on the way in, since a plugin may spell a header
   * however it likes and a second spelling must not survive beside ours.
   */
  static apply(headers: Record<string, string>, policy: string): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!ResponseSandbox.Owned.includes(name.toLowerCase())) kept[name] = value;
    }
    kept["X-Content-Type-Options"] = "nosniff";
    kept["Content-Security-Policy"] = policy;
    return kept;
  }
}
