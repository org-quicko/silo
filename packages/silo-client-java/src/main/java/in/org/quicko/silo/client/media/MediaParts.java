package in.org.quicko.silo.client.media;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;

/**
 * Builds the multipart body an upload and a replace both send. Shared rather
 * than copied into the second: the server reads the extension off the filename
 * on both paths, and two spellings of that could disagree about what is being
 * sent.
 */
final class MediaParts {
  private MediaParts() {}

  static MultipartBody form(byte[] bytes, String filename, String contentType, String folder) {
    if (filename == null || filename.isBlank()) {
      throw new IllegalArgumentException("media: an upload needs a filename, which is what the "
          + "server reads the extension off");
    }

    MediaType type = contentType == null ? null : MediaType.parse(contentType);
    MultipartBody.Builder form = new MultipartBody.Builder()
        .setType(MultipartBody.FORM)
        .addFormDataPart("file", filename, RequestBody.create(bytes, type));

    if (folder != null && !folder.isEmpty()) form.addFormDataPart("folder", folder);
    return form.build();
  }
}
