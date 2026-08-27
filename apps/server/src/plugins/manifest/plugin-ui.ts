/**
 * An admin panel a package contributes (D41).
 *
 * This is the contribution §12.8 held back, and it held it back for a stated
 * reason rather than a lack of time: *"custom panels only once an iframe message
 * contract is designed"*, because the admin SPA is content-hashed and embedded
 * in the binary at build time (D26), so a plugin cannot ship React into it and
 * the alternative — a document boundary — freezes a contract nobody had tested.
 *
 * What made it designable was having a plugin that could not work without one.
 * A destructive importer needs a screen, and the two ways to give it one without
 * this were both wrong:
 *
 * - **A plugin route returning HTML** has to be `auth: "public"` for a browser
 *   to reach it from an address bar, because there is nowhere to put a key. That
 *   publishes the importer, and §13.18 is explicit that a public route publishes
 *   whatever the plugin was granted to anyone who can reach the port.
 * - **A first-party admin view** is not a plugin at all.
 *
 * So a panel is *declared here*, **served as data** (`PluginPanel`), and turned
 * into a document only by the admin, inside a sandboxed iframe with no origin of
 * its own. The three properties that follow are the contract:
 *
 * - The panel cannot read the admin's credentials. `sandbox="allow-scripts"`
 *   without `allow-same-origin` gives it an opaque origin, so `localStorage`
 *   throws — which matters concretely and not theoretically: the admin keeps
 *   `silo_servers` there, holding an API key for **every** instance the operator
 *   has configured.
 * - The panel cannot make a request of its own. It has no credential, and the
 *   opaque origin means nothing it fetches carries one.
 * - Its only channel out is `postMessage` to the admin, which relays **only** to
 *   `/api/ext/<this plugin>/*`. So a panel acts with the *operator's* authority
 *   over the plugin's own routes, and the handler on the far side acts with the
 *   *plugin's* — which is the right way round, and is why no route here has to
 *   be public.
 */
export interface PluginUi {
  /**
   * The HTML file inside the package, relative to its directory.
   *
   * One file and not a directory, which is the narrow choice on purpose. A
   * directory means a static asset server inside the API — a path grammar, a
   * content-type table, a traversal check per request — and every one of those is
   * a way for plugin-authored bytes to be served from silo's own origin, which
   * is the hazard this whole design is arranged around. A panel that needs CSS
   * and script inlines them, exactly as a plugin has no runtime dependencies.
   */
  entry: string;

  /** What the admin labels the panel. The package name when omitted — a title is
   *  for a human choosing between tabs, so a bad default is worse than none. */
  title?: string;
}
