package in.org.quicko.silo.client.transport;

import java.nio.charset.StandardCharsets;

/**
 * Every path in the client, built in one place. Every dynamic segment is
 * percent-encoded, so a name containing a slash or a space addresses one
 * resource rather than being split across the path.
 *
 * <p>Uses {@code /envs/}, not {@code /environments/} — the API accepts both, and
 * one spelling is enough to build with.
 */
public final class ApiPath {
  private ApiPath() {}

  public static String health() {
    return "/api/health";
  }

  public static String projects() {
    return "/api/projects";
  }

  public static String project(String project) {
    return "/api/projects/" + segment(project);
  }

  public static String environments(String project) {
    return project(project) + "/envs";
  }

  public static String environment(String project, String env) {
    return environments(project) + "/" + segment(env);
  }

  public static String projectVariables(String project) {
    return project(project) + "/variables";
  }

  public static String projectVariable(String project, String name) {
    return projectVariables(project) + "/" + segment(name);
  }

  public static String environmentVariables(String project, String env) {
    return environment(project, env) + "/variables";
  }

  public static String environmentVariable(String project, String env, String name) {
    return environmentVariables(project, env) + "/" + segment(name);
  }

  public static String collections(String project, String env) {
    return environment(project, env) + "/collections";
  }

  public static String collection(String project, String env, String name) {
    return collections(project, env) + "/" + segment(name);
  }

  public static String schemas(String project, String env) {
    return environment(project, env) + "/schemas";
  }

  public static String collectionSchema(String project, String env, String name) {
    return collection(project, env, name) + "/schema";
  }

  /**
   * List and create entries: the same address as {@link #collection}, one level
   * down in what it means — the collection's own record versus its rows.
   */
  public static String entries(String project, String env, String name) {
    return collection(project, env, name);
  }

  public static String entry(String project, String env, String name, String id) {
    return collection(project, env, name) + "/" + segment(id);
  }

  public static String collectionSearch(String project, String env, String name) {
    return collection(project, env, name) + "/search";
  }

  public static String environmentSearch(String project, String env) {
    return environment(project, env) + "/search";
  }

  public static String instanceSearch() {
    return "/api/search";
  }

  public static String media() {
    return "/api/media";
  }

  public static String mediaExtensions() {
    return "/api/media/extensions";
  }

  public static String mediaAsset(String id) {
    return "/api/media/" + segment(id);
  }

  public static String mediaAssetUsages(String id) {
    return mediaAsset(id) + "/usages";
  }

  public static String mediaAssetContent(String id) {
    return mediaAsset(id) + "/content";
  }

  public static String mediaBulkDelete() {
    return "/api/media/delete";
  }

  public static String mediaFolders() {
    return "/api/media/folders";
  }

  /**
   * Percent-encodes one path segment or query component. The unreserved set is
   * JavaScript's encodeURIComponent, so this client and the TypeScript one
   * address a name holding a space or a slash identically.
   */
  public static String segment(String value) {
    StringBuilder encoded = new StringBuilder(value.length() + 8);
    for (byte raw : value.getBytes(StandardCharsets.UTF_8)) {
      int octet = raw & 0xFF;
      if (isUnreserved(octet)) {
        encoded.append((char) octet);
      } else {
        encoded.append('%')
            .append(Character.toUpperCase(Character.forDigit(octet >> 4, 16)))
            .append(Character.toUpperCase(Character.forDigit(octet & 0x0F, 16)));
      }
    }
    return encoded.toString();
  }

  private static boolean isUnreserved(int octet) {
    return (octet >= 'A' && octet <= 'Z')
        || (octet >= 'a' && octet <= 'z')
        || (octet >= '0' && octet <= '9')
        || "-_.!~*'()".indexOf(octet) >= 0;
  }
}
