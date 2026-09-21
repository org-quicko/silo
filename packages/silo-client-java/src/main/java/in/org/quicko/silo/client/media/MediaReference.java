package in.org.quicko.silo.client.media;

/**
 * The {@code silo://media/<id>} scheme an entry field holds to name a catalogued
 * asset.
 *
 * <p>Recognises only the canonical scheme form, deliberately narrower than the
 * server's: a client either builds a reference itself or reads one back
 * verbatim, so accepting an asset's {@code url} here would let "I stored the
 * wrong property" keep working until the first rename.
 */
public final class MediaReference {
  private static final String Scheme = "silo://media/";

  private MediaReference() {}

  /** The reference to store in an entry field. */
  public static String of(String id) {
    return Scheme + id;
  }

  /** The asset id a reference names, or null when {@code value} is not one. A
   *  trailing fragment, query or path segment is ignored. */
  public static String idOf(Object value) {
    if (!(value instanceof String text) || !text.startsWith(Scheme)) return null;
    String rest = text.substring(Scheme.length());
    int end = rest.length();
    for (int index = 0; index < rest.length(); index++) {
      char character = rest.charAt(index);
      if (character == '#' || character == '?' || character == '/') {
        end = index;
        break;
      }
    }
    String id = rest.substring(0, end);
    return id.isEmpty() ? null : id;
  }
}
