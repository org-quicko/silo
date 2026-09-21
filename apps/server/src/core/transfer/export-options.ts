import type { MediaMode } from "./media-mode";
import type { TransferSelection } from "./transfer-selection";

export interface ExportOptions {
  withKeys?: boolean;
  siloVersion?: string;
  exportedAt?: Date;
  /** Named after the `include` parameter that carries it. Absent, or
   *  `TransferSelection.Everything`, exports the whole instance. */
  include?: TransferSelection;
  /** Absent takes `MediaModes.default()` for the selection's breadth. */
  media?: MediaMode;
}
