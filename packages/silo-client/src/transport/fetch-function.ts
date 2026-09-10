/**
 * The shape `Transport` calls to make a request: fetch's call signature, so
 * any drop-in replacement (a test double, a patched runtime fetch) can
 * stand in for it via `SiloOptions.fetch`.
 *
 * A plain function type rather than `typeof fetch`, deliberately: the
 * ambient global `fetch` can carry extra static properties in some runtimes
 * (Bun's `fetch.preconnect`, for one), and this type should demand only the
 * call signature a replacement actually needs.
 */
export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
