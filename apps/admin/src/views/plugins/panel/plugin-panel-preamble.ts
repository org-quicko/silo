import { PANEL_PROTOCOL } from './plugin-panel-protocol'

/**
 * The document a panel is actually loaded as (D41).
 *
 * A plugin ships markup; this wraps it in the half of the contract that lives on
 * the panel's side — a `window.silo` client over `postMessage`, and the admin's
 * theme tokens as CSS custom properties.
 *
 * **Generated here rather than documented for authors to reimplement**, and that
 * is the difference between a contract and a convention. Every panel that had to
 * write its own `postMessage` correlation would get the same three things wrong
 * (a shared id counter, an unremoved listener, a promise that never settles when
 * the frame is torn down), and a fix would then have to reach every plugin
 * instead of this file. It is also what lets `PANEL_PROTOCOL` mean something: the
 * only client of the wire format is the one silo emits, so version 2 can change
 * the wire and keep `silo.fetch` identical.
 *
 * The doctype leads, so the panel is in standards mode. A panel that ships its
 * own `<!doctype html>` gets it dropped as a stray by the parser — which is the
 * outcome to want, because the alternative is a panel that silently renders in
 * quirks mode depending on whether its author wrote one.
 */
export function pluginPanelDocument(options: {
  plugin: string
  html: string
  /** Resolved values of the admin's own CSS custom properties, read from the
   *  live document so a panel matches the operator's theme rather than a copy of
   *  the default one. */
  theme: Record<string, string>
  scope: { project: string; env: string } | null
}): string {
  const tokens = Object.entries(options.theme)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  const context = JSON.stringify({
    protocol: PANEL_PROTOCOL,
    plugin: options.plugin,
    scope: options.scope,
    base: `/api/ext/${encodeURIComponent(options.plugin)}`,
  })

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<style>\n:root {\n${tokens}\n}\n${PANEL_BASE_CSS}</style>`,
    `<script>window.__siloPanelContext = ${context};${PANEL_CLIENT_JS}</script>`,
    '</head><body>',
    options.html,
    '</body></html>',
  ].join('\n')
}

/**
 * Enough CSS that a panel which styles nothing still looks like part of the
 * admin.
 *
 * Deliberately only the ambient layer — colours, type, and the form controls a
 * browser would otherwise render in its own defaults against a dark background,
 * which is the one thing that makes an embedded panel look broken rather than
 * plain. No layout, no components: a panel that wanted those would be asking
 * this file to become a design system, and the admin's own CSS Modules are
 * content-hashed and not addressable from here anyway.
 */
const PANEL_BASE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
/* Painted, not transparent. A frame's canvas has a base colour of white and a
   transparent document does not reveal what is behind the frame — it reveals
   that. Any pixel the panel does not cover was therefore a white band across a
   dark admin, most visibly in the moment after a panel's content shrinks. */
html { background: var(--panel); }
body {
  background: transparent;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: 1.55;
}
a { color: var(--accent); }
code, pre, kbd { font-family: var(--font-mono); font-size: 12px; }
h1, h2, h3, h4 { margin: 0 0 8px; font-weight: 600; line-height: 1.3; }
p { margin: 0 0 10px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }
button, input, select, textarea {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}
button { cursor: pointer; background: var(--panel-2); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
th { color: var(--text-2); font-weight: 500; }
::placeholder { color: var(--text-3); }
`

/**
 * The panel-side client, as source, because it is injected into a document the
 * admin's own bundle never loads.
 *
 * `silo.fetch` deliberately mirrors `ctx.fetch` on the plugin side, down to
 * `json()` and `text()` being synchronous: the bytes have already crossed the
 * boundary by the time a panel holds the answer, so there is nothing left to
 * await, and a plugin author moving between the two halves of their own package
 * should not have to remember which one is which.
 *
 * A refusal comes back as a **rejection** here and not as a status, which is the
 * one place the two clients differ on purpose. A status means the server
 * answered; a refused message never left the browser, and reporting it as an
 * HTTP result would tell the author their route returned something it never saw.
 */
const PANEL_CLIENT_JS = `
(function () {
  var context = window.__siloPanelContext;
  var pending = new Map();
  var counter = 0;
  var lastHeight = -1;

  window.addEventListener('message', function (event) {
    // Only the admin that created this frame can be event.source here: a
    // sandboxed frame has no window handle for anyone else, and the parent is
    // the only window it was given.
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.silo !== ${PANEL_PROTOCOL}) return;
    var waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.kind === 'error') waiter.reject(new Error(message.message));
    else waiter.resolve(answer(message));
  });

  function answer(message) {
    var bytes = message.bytes || new Uint8Array(0);
    var decoded = null;
    return {
      status: message.status,
      ok: message.ok,
      headers: message.headers || {},
      bytes: bytes,
      text: function () {
        if (decoded === null) decoded = new TextDecoder().decode(bytes);
        return decoded;
      },
      json: function () {
        var body = this.text();
        return body.length === 0 ? null : JSON.parse(body);
      },
    };
  }

  function post(message) {
    window.parent.postMessage(Object.assign({ silo: ${PANEL_PROTOCOL} }, message), '*');
  }

  var silo = {
    plugin: context.plugin,
    scope: context.scope,
    protocol: context.protocol,

    /** A request to this plugin's own routes. A bare or relative path is
     *  resolved against /api/ext/<plugin>, so a panel never spells its own
     *  mount point — the same property a route handler has. */
    fetch: function (path, init) {
      init = init || {};
      var id = 'p' + ++counter;
      var target = String(path || '/');
      if (target.charAt(0) !== '/') target = '/' + target;
      if (target.indexOf(context.base) !== 0) target = context.base + target;

      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        post({
          kind: 'fetch',
          id: id,
          method: init.method || 'GET',
          path: target,
          headers: init.headers || {},
          body: init.body === undefined ? null : init.body,
        });
      });
    },

    /** JSON in, parsed JSON out, throwing on a refusal — what most calls want. */
    json: async function (path, init) {
      init = Object.assign({}, init);
      if (init.body !== undefined && typeof init.body !== 'string') {
        init.body = JSON.stringify(init.body);
      }
      init.headers = Object.assign({ 'content-type': 'application/json' }, init.headers || {});
      var response = await silo.fetch(path, init);
      var body = response.json();
      if (!response.ok) {
        var error = new Error((body && body.error && body.error.message) || ('HTTP ' + response.status));
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    },

    /** Tell the admin how tall this panel wants to be. Called automatically
     *  while the document resizes, because a panel cannot see the frame.
     *
     *  Repeats are dropped here rather than in the admin: measuring runs on
     *  every reflow, and a panel that posted the same number sixty times a
     *  second would have the admin re-render for each one. */
    height: function (value) {
      var wanted = Math.ceil(value);
      if (wanted === lastHeight) return;
      lastHeight = wanted;
      post({ kind: 'height', height: wanted });
    },
  };

  window.silo = silo;

  // The body, never documentElement. documentElement.scrollHeight is at least
  // the viewport, and the viewport is the height the admin just granted — so
  // measuring it reports back whatever was last asked for and a panel can only
  // ever grow. Measured: a panel that had been tall stayed tall after its
  // content collapsed, leaving the frame's own canvas showing under it.
  //
  // Margins are added because scrollHeight excludes the body's own, and a panel
  // that set one would have it clipped.
  // A body with children and no height has not been laid out yet — which is
  // what a sandboxed frame reports at DOMContentLoaded *and* again at load,
  // because an opaque-origin frame has not been through a rendering lifecycle
  // by then. Reporting that zero snapped the frame to its minimum; ignoring it
  // outright risked a panel pinned there if no later reflow ever came. So it
  // asks again, on a timer rather than a frame callback, because a frame the
  // browser is not painting runs the first and not the second. Bounded: a panel
  // that is genuinely empty stops asking.
  var settling = 0;

  function measure() {
    var body = document.body;
    if (!body) return;
    var height = body.scrollHeight;

    if (height === 0 && body.children.length > 0) {
      if (settling < 40) {
        settling++;
        setTimeout(measure, 50);
      }
      return;
    }

    settling = 0;
    var style = window.getComputedStyle(body);
    var margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    silo.height(height + margins);
  }

  // Held in a variable, and that is load-bearing rather than tidy: an observer
  // nothing references is collectable, and a collected one stops reporting
  // without any sign that it has. Measured — a panel that renders after a fetch
  // (which is most of them) measured an empty body at DOMContentLoaded, posted
  // that, and never posted again.
  var sizes = null;

  function observe() {
    if (!document.body) return;
    if (typeof ResizeObserver === 'function') {
      sizes = new ResizeObserver(measure);
      // The body for content that arrives late, documentElement for a width
      // change from the parent: the frame resizes, the body reflows, and the
      // height is re-measured from the reflow rather than from the resize.
      // Measuring the body from both is what keeps this shrinking.
      sizes.observe(document.body);
      sizes.observe(document.documentElement);
    }
    measure();
  }

  window.addEventListener('load', measure);
  document.addEventListener('DOMContentLoaded', function () {
    post({ kind: 'ready' });
    observe();
  });
})();
`
