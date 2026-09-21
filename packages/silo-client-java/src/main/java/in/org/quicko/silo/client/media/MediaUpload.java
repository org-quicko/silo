package in.org.quicko.silo.client.media;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * One file on its way into the library.
 *
 * <p>The filename is not cosmetic: the server reads the extension off it to
 * decide what the library accepts, and on a replace to decide whether the file's
 * type is changing at all. A class rather than a record because it holds a byte
 * array, whose equality would be identity and would read as a value's.
 */
public final class MediaUpload {
  private final byte[] bytes;
  private final String filename;
  private final String contentType;
  private final String folder;

  private MediaUpload(byte[] bytes, String filename, String contentType, String folder) {
    this.bytes = bytes;
    this.filename = filename;
    this.contentType = contentType;
    this.folder = folder;
  }

  public static MediaUpload of(byte[] bytes, String filename) {
    return new MediaUpload(bytes, filename, null, null);
  }

  /** Reads the file now, and takes its name from the path. */
  public static MediaUpload of(Path file) {
    try {
      return new MediaUpload(Files.readAllBytes(file), file.getFileName().toString(), null, null);
    } catch (IOException caught) {
      throw new UncheckedIOException("could not read " + file + " to upload it", caught);
    }
  }

  /** Overrides what the server would otherwise infer from the extension. */
  public MediaUpload contentType(String value) {
    return new MediaUpload(bytes, filename, value, folder);
  }

  /** Where the asset lands. Unset means the library root. */
  public MediaUpload folder(String value) {
    return new MediaUpload(bytes, filename, contentType, value);
  }

  public byte[] bytes() {
    return bytes;
  }

  public String filename() {
    return filename;
  }

  public String contentType() {
    return contentType;
  }

  public String folder() {
    return folder;
  }
}
