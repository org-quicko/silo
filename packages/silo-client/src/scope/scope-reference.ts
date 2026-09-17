import type { Transport } from "../transport/transport.js";

/**
 * The transport and scope names shared by handles within one environment.
 */
export class ScopeReference {
  constructor(
    readonly transport: Transport,
    readonly project: string,
    readonly environment: string,
  ) {}
}
