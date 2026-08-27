export interface SearchConfig {
  /**
   * When false, no index is kept and search falls back to the portable
   * engine (D30). Switching it off also drops any index a previous run left,
   * so it cannot rot into wrong answers if it is switched back on later.
   */
  enabled: boolean;

  /**
   * `unicode61` splits on non-alphanumerics; `trigram` matches substrings.
   * The tokenizer is fixed into the FTS5 table at creation, so changing it
   * rebuilds the index. Deployments with Chinese, Japanese or Korean content
   * must choose `trigram`: `unicode61` does not segment CJK, so a whole run
   * becomes one term and word search cannot work.
   */
  tokenizer: "unicode61" | "trigram";

  /** Per-entry cap on indexed text, so one huge field cannot crowd out the rest. */
  max_entry_bytes: number;

  /** How many entries one portable-engine scan may visit before truncating. */
  scan_limit: number;

  /** ...and how long it may spend, whichever comes first. */
  scan_time_budget_ms: number;
}
