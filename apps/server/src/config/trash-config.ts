/**
 * How long a deleted thing stays recoverable (D91). See §11 in
 * [docs/design/configuration.md](../../../../docs/design/configuration.md).
 */
export interface TrashConfig {
  /**
   * Off restores silo's pre-D91 behaviour exactly: every delete is immediate
   * and permanent, and the trash routes answer as if the trash were empty.
   * Named rather than implied by `retention_days = 0`, because "keep forever"
   * and "do not keep" both want a number and only one of them can have zero.
   */
  enabled: boolean;

  /** Days before the sweeper purges a receipt. Zero keeps it until someone
   *  purges it by hand. */
  retention_days: number;
}
