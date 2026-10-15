package in.org.quicko.silo.client.trash;

/** What a trash receipt stands for (D113). */
public enum TrashKind {
  PROJECT("project"),
  ENVIRONMENT("environment"),
  COLLECTION("collection"),
  ENTRY("entry"),
  MEDIA("media"),
  MEDIA_FOLDER("media_folder");

  private final String wireValue;

  TrashKind(String wireValue) {
    this.wireValue = wireValue;
  }

  public String wireValue() {
    return wireValue;
  }

  /** Strict: a kind this client does not know is a client change, not a
   *  default to guess. */
  public static TrashKind of(String value) {
    for (TrashKind kind : values()) {
      if (kind.wireValue.equals(value)) return kind;
    }
    throw new IllegalArgumentException("unknown trash kind \"" + value + "\"");
  }
}
