package in.org.quicko.silo.client.media;

/**
 * Where an asset is in its life. {@code DELETING} is a delete that was staged
 * but whose bytes the blob store has not yet given up.
 */
public enum MediaState {
  ACTIVE("active"),
  DELETING("deleting");

  private final String wireValue;

  MediaState(String wireValue) {
    this.wireValue = wireValue;
  }

  public String wireValue() {
    return wireValue;
  }

  /** An unrecognised state reads as {@link #ACTIVE}, which is what every
   *  route but a staged delete answers. */
  public static MediaState of(String value) {
    for (MediaState state : values()) {
      if (state.wireValue.equals(value)) return state;
    }
    return ACTIVE;
  }
}
