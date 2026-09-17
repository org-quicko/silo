import type { TTLCache } from "@isaacs/ttlcache";
import type { Transport } from "./transport/transport.js";

/** The transport and optional cache shared by handles of one Silo instance. */
export class SiloContext {
  constructor(
    readonly transport: Transport,
    readonly cache?: TTLCache<string, unknown>,
  ) {}
}
