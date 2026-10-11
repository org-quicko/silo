import '../transport/api_path.dart';

/// How far a search reaches. It is the receiver, never an argument.
final class SearchReach {
  SearchReach.collection(String project, String environment, String name)
    : path = ApiPath.collectionSearch(project, environment, name);

  SearchReach.environment(String project, String environment) : path = ApiPath.environmentSearch(project, environment);

  SearchReach.instance() : path = ApiPath.instanceSearch();

  final String path;
}
