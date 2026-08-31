import type { ConfigSectionView } from "./config-section-view";

/**
 * What `GET /api/settings` returns (D47): every table the API knows about, plus
 * the facts about the file itself that decide whether any of it can be saved.
 */
export interface ConfigSettingsView {
  sections: ConfigSectionView[];
  config_path?: string;
  /** False when the process was started with no config file, in which case
   *  there is nothing to write and every section is read-only. */
  writable: boolean;
  /** True while any saved field is waiting for a restart, so the page can say
   *  so once at the top rather than only field by field. */
  restart_pending: boolean;
}
