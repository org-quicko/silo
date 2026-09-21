package in.org.quicko.silo.client.media;

import java.time.Instant;
import java.util.List;

/**
 * One catalogued asset's mapped state — {@link MediaMapper}'s output and the
 * value {@link MediaAsset} holds.
 *
 * <p>{@code reference} is what belongs in an entry field; {@code url} is only
 * where to fetch today's bytes, and a rename or a move can change it.
 */
public record MediaAssetRecord(
    String id,
    String filename,
    String folder,
    String blobKey,
    long sizeInBytes,
    String contentType,
    String hash,
    MediaState state,
    List<String> tags,
    String url,
    long usageCount,
    Instant createdAt,
    Instant updatedAt) {

  public MediaAssetRecord {
    tags = tags == null ? List.of() : List.copyOf(tags);
  }
}
