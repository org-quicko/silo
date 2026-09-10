import { ApiPath } from "../transport/api-path.js";

/**
 * How far one search reaches: one collection, one environment, or the
 * whole instance. The reach is the receiver a caller calls `search()` on, so
 * a forgotten argument cannot widen a search past what was asked for.
 */
export class SearchReach {
  private constructor(readonly path: string) {}

  static collection(project: string, environment: string, name: string): SearchReach {
    return new SearchReach(ApiPath.collectionSearch(project, environment, name));
  }

  static environment(project: string, environment: string): SearchReach {
    return new SearchReach(ApiPath.environmentSearch(project, environment));
  }

  static instance(): SearchReach {
    return new SearchReach(ApiPath.instanceSearch());
  }
}
