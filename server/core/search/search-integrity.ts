/** What a search index looks like from the outside (D30). */
export interface SearchIntegrity {
  /** `"ok"`, or the message FTS5's own `integrity-check` raised. */
  index: string;
  /** Index documents whose entry has gone — invisible to the built-in check. */
  orphanDocuments: number;
  /** Entries with no index document — likewise invisible to it. */
  missingDocuments: number;
}
