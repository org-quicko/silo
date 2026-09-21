package in.org.quicko.silo.client.entries;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.RowLoader;
import in.org.quicko.silo.client.pagination.RowStream;

/**
 * What {@code collection.all()} answers: entries one at a time, across every
 * page. Named for what it yields, though the paging is entirely
 * {@link RowStream}'s.
 */
public final class EntryStream<F> extends RowStream<Entry<F>> {
  public EntryStream(RowLoader<Entry<F>> loader, int startingLimit, RequestOptions options) {
    super(loader, startingLimit, options);
  }
}
