package in.org.quicko.silo.client.errors;

/**
 * A {@code 500} where the asset was staged for deletion but the blob store
 * refused to remove its bytes. Not a refusal like {@link MediaInUseException} —
 * it is a storage failure the caller fixes by fixing the blob store, or by
 * running the remedy this exception names.
 */
public class MediaDeleteStalledException extends SiloException {
  private final String remedy;

  public MediaDeleteStalledException(String message, String method, String path, String remedy) {
    super(500, "media_delete_stalled", message, method, path);
    this.remedy = remedy;
  }

  /** What the server says will clear the stall, or {@code ""} when it said nothing. */
  public String remedy() {
    return remedy;
  }
}
