/** The severities silo logs at, plus `silent` — which is a threshold, not a level. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Ranking and parsing for `LogLevel`.
 *
 * The union and the table that orders it live in one file on purpose: a level
 * whose rank is unknown is not a level, so adding a member without ranking it
 * must not compile. `Record<LogLevel, number>` is what enforces that, and it
 * only works if the two are declared together.
 */
export class LogLevels {
  /** Ordered least to most severe. `silent` is above all of them. */
  private static readonly ranks: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  static readonly Silent = "silent";

  static rank(level: LogLevel): number {
    return LogLevels.ranks[level];
  }

  static isLevel(value: string): value is LogLevel {
    return Object.hasOwn(LogLevels.ranks, value);
  }

  /**
   * The rank at or above which a message is emitted. An unrecognised name
   * falls back to `info` rather than throwing: a typo in `[log] level` must
   * not stop the server booting, and silently logging *nothing* would be the
   * worse failure of the two.
   */
  static threshold(level: string): number {
    if (level === LogLevels.Silent) return Number.POSITIVE_INFINITY;
    return LogLevels.isLevel(level) ? LogLevels.rank(level) : LogLevels.rank("info");
  }
}
