import type { SiloContext } from "../SiloContext.js";

/**
 * The client context and scope names shared by handles within one environment.
 */
export class ScopeReference {
  constructor(
    readonly siloContext: SiloContext,
    readonly project: string,
    readonly environment: string,
  ) {}
}
