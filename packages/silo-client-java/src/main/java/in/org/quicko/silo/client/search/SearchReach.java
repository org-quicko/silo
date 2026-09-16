package in.org.quicko.silo.client.search;

import in.org.quicko.silo.client.transport.ApiPath;

/**
 * How far one search reaches: one collection, one environment, or the whole
 * instance. The reach is the receiver a caller calls {@code search()} on, so a
 * forgotten argument cannot widen a search past what was asked for.
 */
public final class SearchReach {
  private final String path;

  private SearchReach(String path) {
    this.path = path;
  }

  public static SearchReach collection(String project, String environment, String name) {
    return new SearchReach(ApiPath.collectionSearch(project, environment, name));
  }

  public static SearchReach environment(String project, String environment) {
    return new SearchReach(ApiPath.environmentSearch(project, environment));
  }

  public static SearchReach instance() {
    return new SearchReach(ApiPath.instanceSearch());
  }

  public String path() {
    return path;
  }
}
