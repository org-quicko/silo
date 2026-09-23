/// The engine that answered: SQLite FTS5, or the portable scan.
enum SearchEngine {
  fts5,
  scan;

  static SearchEngine of(Object? value) => value == 'fts5' ? fts5 : scan;
}
