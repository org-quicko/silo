package in.org.quicko.silo.client.trash;

/** The window {@code trash.contents()} asks for. Unset, the server picks it. */
public record TrashContentsQuery(Integer limit, Integer offset) {
  private static final TrashContentsQuery All = new TrashContentsQuery(null, null);

  public static TrashContentsQuery all() {
    return All;
  }

  public TrashContentsQuery limit(int value) {
    return new TrashContentsQuery(value, offset);
  }

  public TrashContentsQuery offset(int value) {
    return new TrashContentsQuery(limit, value);
  }
}
