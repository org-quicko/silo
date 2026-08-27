/**
 * What a route accepts as a request body, declared in the manifest (D41).
 *
 * Before this there was nothing to declare: `ExtRequest` decoded every body as
 * UTF-8 text and capped every route at one global mebibyte, so a plugin whose
 * whole job is ingesting a file — a database export, an archive, a spreadsheet —
 * was not merely awkward to write but **impossible**. `ctx.media` is metadata
 * only ("the bytes are not reachable through `ctx`"), so there was no second
 * door either. That is the hole this closes, and closing it needs the two
 * questions below answered *per route* rather than once for the instance.
 *
 * It is **declared** for §13.2's reason, and the reason is sharper here than
 * anywhere else in the block: the number below is how much the host will
 * allocate on behalf of whoever reaches this route. An operator approving
 * `http:route` is approving that allocation, so it has to be readable on the
 * grant screen before any of the package's code runs — and it joins the manifest
 * digest, because raising it changes what a standing approval permits without
 * changing a single claim.
 */
export type PluginRouteBodyKind = "text" | "bytes";

export interface PluginRouteBody {
  /**
   * `text` decodes UTF-8 and hands the handler a string; `bytes` hands it a
   * `Uint8Array` and decodes nothing.
   *
   * Two kinds rather than always sending bytes and letting the plugin decode,
   * because the existing behaviour is the common one and `TextDecoder` in every
   * handler would be ceremony. And rather than guessing from `content-type`,
   * which would make the host responsible for a decision only the route knows
   * the answer to — the same argument `PluginServeRequest.body` already carries
   * about parsing.
   */
  kind: PluginRouteBodyKind;

  /**
   * The largest body this route accepts, in bytes.
   *
   * Refused past it rather than truncated, unchanged from D36: a plugin cannot
   * tell a body it was not given from one that was never sent, so a caller would
   * otherwise get a 200 describing work done on the wrong input.
   *
   * Author-declared and silo-bounded, which is one rule and not two halves of a
   * compromise. The author knows what the route needs and the operator is the one
   * paying for it, so the number is stated where an operator can read it and
   * capped where an author cannot make it a denial of service —
   * `PluginRouteBodies.Ceiling` is that cap, and it is refused at the manifest so
   * the refusal names the package rather than surfacing as a request that never
   * works.
   */
  max_bytes: number;
}
