package in.org.quicko.silo.client.pagination;

/** Loads one page for a given window, and answers the window the server used. */
@FunctionalInterface
public interface RowLoader<Row> {
  RowBatch<Row> load(PageWindow window);
}
