/**
 * The iframe message contract (D41) — §12.8's "custom panels only once an
 * iframe message contract is designed".
 *
 * Pure, and in its own file, because it is the whole security boundary of a
 * plugin panel and a boundary that needs a DOM to test is a boundary nobody
 * tests. `PluginPanelFrame` is the plumbing; every rule is here.
 *
 * ## What a panel is, and is not
 *
 * A panel is HTML a plugin author wrote, rendered in the operator's admin. It
 * runs in an iframe with `sandbox="allow-scripts"` and **no**
 * `allow-same-origin`, so it has an opaque origin: `localStorage` throws,
 * `document.cookie` is empty, `window.parent` is unreachable except through
 * `postMessage`, and nothing it fetches carries a credential. That is not
 * belt-and-braces — the admin keeps `silo_servers` in its own origin's
 * `localStorage`, holding an API key for every instance the operator has
 * configured, so a panel with same-origin access would hold more than any plugin
 * can be granted.
 *
 * So a panel has exactly one capability: **ask the admin to call a route of its
 * own plugin.** Three consequences, and each is a rule below.
 *
 * - It is relayed with the **operator's** key, not the plugin's. A panel is a
 *   screen in someone's session, and the handler on the far side already runs
 *   with the plugin's grant (§13.18) — so the panel needs no authority of its
 *   own, and giving it one would be a second grant nobody approved.
 * - It reaches **only** `/api/ext/<its own plugin>/`. This is the rule that makes
 *   the relay safe to build at all: without it, a panel would be a way to spend
 *   the operator's full claim set on any endpoint, which is strictly worse than
 *   the public-route hazard `contributes.ui` exists to avoid.
 * - Paths are **normalised before they are checked**, not after. `new URL` is
 *   what the eventual `fetch` will do with a relative path anyway, so a check
 *   against the raw string would be checking a different value than the one that
 *   gets requested — `/api/ext/x/../../keys` starts with the prefix and resolves
 *   to `/api/keys`.
 */

/** Bumped only for a breaking change to the shapes below. A panel written
 *  against 1 keeps working until it says otherwise. */
export const PANEL_PROTOCOL = 1

/** What the panel may ask the admin to do. `HEAD` is absent because a panel has
 *  no cache to validate, and `OPTIONS`/`TRACE` because no plugin route serves
 *  them. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * Headers a panel may set on a relayed request.
 *
 * An allowlist and not a denylist. The value being protected is the operator's
 * `Authorization` header, which the transport sets — and a denylist that had to
 * name every spelling a panel might reach for (`authorization`, `x-api-key`,
 * `cookie`, and whatever a future middleware reads) is a list that is wrong the
 * first time one is added. This is the same rule `ExtRequest.Withheld` states in
 * the other direction, chosen the safer way round.
 */
const HEADERS = ['content-type', 'accept'] as const

export interface PanelFetchMessage {
  kind: 'fetch'
  /** The panel's own correlation id, echoed back untouched. Opaque to us. */
  id: string
  method: (typeof METHODS)[number]
  /** Absolute, and inside the panel's own plugin namespace. */
  path: string
  headers: Record<string, string>
  /** Text or bytes. Bytes are what make an upload possible: a `Uint8Array`
   *  survives `postMessage`'s structured clone, so a panel can hand the admin a
   *  file the operator chose and the admin relays it to a route that declared
   *  `body.kind: "bytes"` (D41). */
  body: string | Uint8Array | null
}

export interface PanelHeightMessage {
  kind: 'height'
  /** CSS pixels the panel wants. A panel cannot size itself — it has no idea
   *  how much room the admin has — so it asks and the frame clamps. */
  height: number
}

export interface PanelReadyMessage {
  kind: 'ready'
}

export type PanelMessage = PanelFetchMessage | PanelHeightMessage | PanelReadyMessage

/** Why a panel message was refused. Returned rather than thrown: every one of
 *  these is a plugin author's mistake, and the panel is the only place they can
 *  see it. */
export interface PanelRefusal {
  refused: string
}

export function isRefusal(value: unknown): value is PanelRefusal {
  return typeof value === 'object' && value !== null && 'refused' in value
}

/**
 * The prefix a panel's requests must stay inside.
 *
 * Encoded, because the name reaches this as a path segment and a package name is
 * allowed a `@` and a `/` — `@acme/silo-plugin-x`. The unencoded form would put
 * a second separator in the prefix and make the containment check compare the
 * wrong number of segments.
 */
export function panelPrefix(plugin: string): string {
  return `/api/ext/${encodeURIComponent(plugin)}/`
}

/**
 * Validate one message from a panel, or say why not.
 *
 * `origin` is deliberately not a parameter. A sandboxed iframe without
 * `allow-same-origin` posts from the opaque origin `"null"`, which every other
 * such iframe on the page also posts from — so origin proves nothing here and
 * checking it would be security theatre that also breaks the moment a second
 * panel is open. Identity is established by the caller comparing `event.source`
 * with the frame's own `contentWindow`, which is the thing that is actually
 * unforgeable.
 */
export function readPanelMessage(raw: unknown, plugin: string): PanelMessage | PanelRefusal {
  if (typeof raw !== 'object' || raw === null) return { refused: 'not an object' }
  const message = raw as Record<string, unknown>

  if (message.silo !== PANEL_PROTOCOL) {
    return {
      refused: `every message needs "silo": ${PANEL_PROTOCOL}; got ${JSON.stringify(message.silo)}`,
    }
  }

  if (message.kind === 'ready') return { kind: 'ready' }

  if (message.kind === 'height') {
    const height = message.height
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 0) {
      return { refused: `"height" must be a non-negative number; got ${JSON.stringify(height)}` }
    }
    return { kind: 'height', height }
  }

  if (message.kind !== 'fetch') {
    return { refused: `unknown "kind": ${JSON.stringify(message.kind)}` }
  }

  if (typeof message.id !== 'string' || message.id.length === 0) {
    return { refused: 'a fetch needs a non-empty string "id" to correlate the answer with' }
  }
  const method = String(message.method || 'GET').toUpperCase()
  if (!(METHODS as readonly string[]).includes(method)) {
    return { refused: `"${method}" is not one of ${METHODS.join(', ')}` }
  }

  const path = readPanelPath(message.path, plugin)
  if (isRefusal(path)) return path

  const body = readPanelBody(message.body)
  if (isRefusal(body)) return body

  return {
    kind: 'fetch',
    id: message.id,
    method: method as PanelFetchMessage['method'],
    path,
    headers: readPanelHeaders(message.headers),
    body,
  }
}

/**
 * The path this request will actually be made against, if it stays inside the
 * plugin's namespace.
 *
 * Normalised **first**. A `..` segment is not refused by name — it is resolved,
 * and then the result is checked, which is the only version of this check that
 * cannot be walked around by a spelling nobody thought of (`%2e%2e`, a doubled
 * separator, a `.` between two climbs). What comes back is the normalised
 * string, so the caller requests exactly what was approved rather than the raw
 * text beside it.
 */
export function readPanelPath(raw: unknown, plugin: string): string | PanelRefusal {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { refused: '"path" must be a non-empty string' }
  }
  if (!raw.startsWith('/')) {
    return { refused: `"path" must be absolute and start with ${panelPrefix(plugin)}` }
  }

  const base = 'http://panel.invalid'
  let resolved: URL
  try {
    // A fixed opaque base: only the pathname and search are read back out, and a
    // base is required for a relative resolve. A `path` carrying its own scheme
    // or host is caught by the origin check below rather than here, because
    // `new URL` would happily accept it and quietly change the destination.
    resolved = new URL(raw, base)
  } catch {
    return { refused: `"path" is not a usable path: ${raw}` }
  }
  if (resolved.origin !== base) {
    return { refused: '"path" must be a path, not a URL — it is relayed to the open server' }
  }

  const prefix = panelPrefix(plugin)
  const inside = resolved.pathname === prefix.slice(0, -1) || resolved.pathname.startsWith(prefix)
  if (!inside) {
    return {
      refused:
        `a panel may only call its own plugin's routes. "${resolved.pathname}" is outside ` +
        `${prefix} — the admin relays with the operator's key, so this is the boundary that ` +
        `keeps a panel from spending it elsewhere.`,
    }
  }
  return resolved.pathname + resolved.search
}

function readPanelHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {}
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = name.toLowerCase()
    if (!(HEADERS as readonly string[]).includes(lower)) continue
    if (typeof value === 'string') headers[lower] = value
  }
  return headers
}

function readPanelBody(raw: unknown): string | Uint8Array | null | PanelRefusal {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  return { refused: '"body" must be a string, a Uint8Array, an ArrayBuffer, or absent' }
}
