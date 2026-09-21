/** The listener's defaults and the one bound the runtime imposes on them. */
export class HttpDefaults {
  /** `Bun.serve` refuses a larger value outright. */
  static readonly MaxIdleTimeout = 255;

  /**
   * Long enough that an import or a copy of a real instance finishes inside
   * it, short enough that a dead connection is still reaped.
   */
  static readonly IdleTimeout = 120;

  /**
   * Clamped rather than refused. A number above the runtime's ceiling says
   * "as long as possible", and failing to start over it would turn a generous
   * config into an outage.
   */
  static idleTimeout(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds < 0) return HttpDefaults.IdleTimeout;
    return Math.min(Math.floor(seconds), HttpDefaults.MaxIdleTimeout);
  }
}
