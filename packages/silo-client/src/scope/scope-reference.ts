import type { Transport } from "../transport/transport.js";

/**
 * The transport plus the project and environment names a handle needs to
 * build its own paths — what `EnvironmentHandle` hands to everything it
 * constructs, so none of them repeats the same three constructor parameters.
 */
export class ScopeReference {
  constructor(
    readonly transport: Transport,
    readonly project: string,
    readonly environment: string,
  ) {}
}
