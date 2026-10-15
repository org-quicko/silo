package in.org.quicko.silo.client.trash;

/** How far a receipt's trash, restore or purge got. Anything but
 *  {@link #PARKED} is still in progress. */
public enum TrashState {
  PARKING("parking"),
  PARKED("parked"),
  RESTORING("restoring"),
  PURGING("purging");

  private final String wireValue;

  TrashState(String wireValue) {
    this.wireValue = wireValue;
  }

  public String wireValue() {
    return wireValue;
  }

  public static TrashState of(String value) {
    for (TrashState state : values()) {
      if (state.wireValue.equals(value)) return state;
    }
    throw new IllegalArgumentException("unknown trash state \"" + value + "\"");
  }
}
