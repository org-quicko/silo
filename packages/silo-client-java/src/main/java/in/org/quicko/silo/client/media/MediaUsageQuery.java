package in.org.quicko.silo.client.media;

/**
 * The window {@code asset.usages()} asks for. The route echoes no window back,
 * so the page is built from what was asked for rather than from what came back.
 */
public record MediaUsageQuery(Integer limit, Integer offset) {
  private static final MediaUsageQuery All = new MediaUsageQuery(null, null);

  public static MediaUsageQuery all() {
    return All;
  }

  public MediaUsageQuery limit(int value) {
    return new MediaUsageQuery(value, offset);
  }

  public MediaUsageQuery offset(int value) {
    return new MediaUsageQuery(limit, value);
  }
}
