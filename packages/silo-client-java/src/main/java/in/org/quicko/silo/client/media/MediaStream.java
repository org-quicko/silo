package in.org.quicko.silo.client.media;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.RowLoader;
import in.org.quicko.silo.client.pagination.RowStream;

/**
 * What {@code media.all()} answers: one asset at a time, across every page. No
 * behaviour of its own — the named type is what makes the return value readable.
 */
public final class MediaStream extends RowStream<MediaAsset> {
  public MediaStream(RowLoader<MediaAsset> loader, int startingLimit, RequestOptions options) {
    super(loader, startingLimit, options);
  }
}
