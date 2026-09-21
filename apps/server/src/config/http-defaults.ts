/** The listener's defaults and the bounds the runtime imposes on them. */
export class HttpDefaults {
  /** `Bun.serve` refuses a larger value outright. */
  static readonly MaxIdleTimeout = 255;

  /**
   * Long enough that an import or a copy of a real instance finishes inside
   * it, short enough that a dead connection is still reaped.
   */
  static readonly IdleTimeout = 120;

  /**
   * The runtime's own ceiling, kept as the default so an upload that worked
   * before this setting existed still works. An instance with little memory
   * should lower it: a body the runtime buffers costs its size per connection.
   */
  static readonly MaxBodySizeMb = 128;

  /**
   * Generous for a JSON document — an entry, a schema, a selection of ids — and
   * small enough that a flood of them cannot hold much.
   */
  static readonly MaxJsonBodySizeMb = 4;

  /**
   * Clamped rather than refused. A number above the runtime's ceiling says
   * "as long as possible", and failing to start over it would turn a generous
   * config into an outage.
   */
  static idleTimeout(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds < 0) return HttpDefaults.IdleTimeout;
    return Math.min(Math.floor(seconds), HttpDefaults.MaxIdleTimeout);
  }

  /** A body size in megabytes, or the fallback when the value is not a positive
   *  number. There is no "unlimited": zero and below name no bound at all. */
  static bodySizeMb(megabytes: number, fallback: number): number {
    if (!Number.isFinite(megabytes) || megabytes <= 0) return fallback;
    return megabytes;
  }

  /** The runtime wants bytes; the file speaks in megabytes. */
  static bytes(megabytes: number): number {
    return Math.ceil(megabytes * 1024 * 1024);
  }
}
