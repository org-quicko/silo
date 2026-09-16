package in.org.quicko.silo.client.search;

/**
 * Which engine answered a search: the portable in-process scan, or SQLite FTS5
 * where the build has it.
 */
public enum SearchEngine {
  FTS5("fts5"),
  SCAN("scan");

  private final String wireValue;

  SearchEngine(String wireValue) {
    this.wireValue = wireValue;
  }

  public String wireValue() {
    return wireValue;
  }

  public static SearchEngine of(String value) {
    return "fts5".equals(value) ? FTS5 : SCAN;
  }
}
