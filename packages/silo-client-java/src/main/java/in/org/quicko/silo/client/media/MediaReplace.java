package in.org.quicko.silo.client.media;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * New bytes for an asset that already exists. There is no folder: a replace
 * changes the bytes and nothing else about where the asset sits.
 *
 * <p>The replacement must keep the current extension. The blob key's suffix is
 * derived from the filename at upload and is the visible tail of the URL on a
 * bucket-backed instance, so a {@code .png} asset takes a {@code .png}
 * replacement. Converting a file is a new upload, not a replacement of this one.
 */
public final class MediaReplace {
  private final byte[] bytes;
  private final String filename;
  private final String contentType;

  private MediaReplace(byte[] bytes, String filename, String contentType) {
    this.bytes = bytes;
    this.filename = filename;
    this.contentType = contentType;
  }

  public static MediaReplace of(byte[] bytes, String filename) {
    return new MediaReplace(bytes, filename, null);
  }

  public static MediaReplace of(Path file) {
    try {
      return new MediaReplace(Files.readAllBytes(file), file.getFileName().toString(), null);
    } catch (IOException caught) {
      throw new UncheckedIOException("could not read " + file + " to replace with it", caught);
    }
  }

  public MediaReplace contentType(String value) {
    return new MediaReplace(bytes, filename, value);
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
}
