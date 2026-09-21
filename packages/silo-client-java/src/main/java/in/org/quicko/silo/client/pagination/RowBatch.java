package in.org.quicko.silo.client.pagination;

import java.util.List;

/** One loaded page as {@link RowStream} sees it: the rows, and the window the
 *  server actually used to answer them. */
public record RowBatch<Row>(List<Row> rows, PageWindow window) {}
