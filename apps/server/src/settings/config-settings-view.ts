import type { ConfigSectionView } from "./config-section-view";

/**
 * What `GET /api/settings` returns (D47): every table the API knows about, plus
 * the facts about the file itself that decide whether any of it can be saved.
 */
export interface ConfigSettingsView {
  sections: ConfigSectionView[];
  config_path?: string;
  /** False when the file cannot be written: the process was started with no
   *  config file, or the path is not writable by it. Every section is
   *  read-only either way. */
  writable: boolean;
  /** Which of the two it is, in the sentence the page shows. */
  read_only_reason?: string;
  /** True while any saved field is waiting for a restart, so the page can say
   *  so once at the top rather than only field by field. */
  restart_pending: boolean;
}
