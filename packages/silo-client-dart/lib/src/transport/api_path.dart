/// Every path the client builds. Each dynamic segment is percent-encoded with
/// the same unreserved set as JavaScript's `encodeURIComponent`.
abstract final class ApiPath {
  static String health() => '/api/health';

  static String projects() => '/api/projects';

  static String project(String project) => '/api/projects/${_segment(project)}';

  static String environments(String project) => '${ApiPath.project(project)}/envs';

  static String environment(String project, String env) => '${environments(project)}/${_segment(env)}';

  static String projectVariables(String project) => '${ApiPath.project(project)}/variables';

  static String projectVariable(String project, String name) => '${projectVariables(project)}/${_segment(name)}';

  static String environmentVariables(String project, String env) => '${environment(project, env)}/variables';

  static String environmentVariable(String project, String env, String name) =>
      '${environmentVariables(project, env)}/${_segment(name)}';

  static String collections(String project, String env) => '${environment(project, env)}/collections';

  static String collection(String project, String env, String name) => '${collections(project, env)}/${_segment(name)}';

  static String schemas(String project, String env) => '${environment(project, env)}/schemas';

  static String collectionSchema(String project, String env, String name) => '${collection(project, env, name)}/schema';

  static String entries(String project, String env, String name) => collection(project, env, name);

  static String entry(String project, String env, String name, String id) =>
      '${collection(project, env, name)}/${_segment(id)}';

  static String collectionSearch(String project, String env, String name) => '${collection(project, env, name)}/search';

  static String environmentSearch(String project, String env) => '${environment(project, env)}/search';

  static String instanceSearch() => '/api/search';

  static String media() => '/api/media';

  static String mediaExtensions() => '/api/media/extensions';

  static String mediaAsset(String id) => '/api/media/${_segment(id)}';

  static String mediaAssetUsages(String id) => '${mediaAsset(id)}/usages';

  static String mediaAssetContent(String id) => '${mediaAsset(id)}/content';

  static String mediaBulkDelete() => '/api/media/delete';

  static String mediaFolders() => '/api/media/folders';

  static String _segment(String value) => Uri.encodeComponent(value);
}
