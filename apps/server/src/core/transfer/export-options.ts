import type { MediaMode } from "./media-mode";
import type { TransferSelection } from "./transfer-selection";

export interface ExportOptions {
  withKeys?: boolean;
  /**
   * A whole-instance move (`silo export --instance`, D97): everything a whole
   * export carries, every key including the ones silo minted for plugins, the
   * plugin grants and the audit log. Offered by the CLI only.
   */
  instance?: boolean;
  siloVersion?: string;
  exportedAt?: Date;
  /** Named after the `include` parameter that carries it. Absent, or
   *  `TransferSelection.Everything`, exports the whole instance. */
  include?: TransferSelection;
  /** Absent takes `MediaModes.default()` for the selection's breadth. */
  media?: MediaMode;
}
