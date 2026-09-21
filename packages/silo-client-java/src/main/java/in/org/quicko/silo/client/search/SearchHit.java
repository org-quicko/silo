package in.org.quicko.silo.client.search;

import in.org.quicko.silo.client.entries.Entry;
import java.util.List;
import java.util.Map;

/**
 * One result. The location sits on the hit rather than on the entry, which is
 * what lets a caller link to a result found outside the scope on screen, and
 * {@code environment} is the one rename — the wire calls it {@code env}.
 *
 * <p>The entry is untyped: a result is not addressed to one collection, so there
 * is no field type to give it. Its {@code {{NAME}}} templates are resolved, so
 * read it again through
 * {@code collection.get(id, EntryReadOptions.raw())} before editing it.
 */
public record SearchHit(
    String project,
    String environment,
    String collection,
    Entry<Map<String, Object>> entry,
    List<SearchSnippet> snippets) {

  public SearchHit {
    snippets = List.copyOf(snippets);
  }
}
