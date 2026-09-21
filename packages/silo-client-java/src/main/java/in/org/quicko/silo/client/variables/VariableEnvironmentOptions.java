package in.org.quicko.silo.client.variables;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What {@code rename()}, {@code describe()} and {@code undeclare()} accept.
 *
 * <p>{@code environment} is not load-bearing for what those three do — all
 * three rewrite the one project-wide record whichever environment is named. It
 * still matters twice: the scope has to resolve to a real environment at all,
 * and for rename and describe it picks which environment's value comes back on
 * the {@link Variable} the call answers. Left unset the server assumes
 * {@code "prod"}, which is a 404 waiting to happen for a project that never
 * created one, so set it explicitly for any other project shape.
 */
public record VariableEnvironmentOptions(String environment, RequestOptions request) {

  public VariableEnvironmentOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static VariableEnvironmentOptions none() {
    return new VariableEnvironmentOptions(null, RequestOptions.none());
  }

  /** Names which environment's value the answer should carry. */
  public static VariableEnvironmentOptions in(String environment) {
    return new VariableEnvironmentOptions(environment, RequestOptions.none());
  }

  public VariableEnvironmentOptions environment(String name) {
    return new VariableEnvironmentOptions(name, request);
  }

  public VariableEnvironmentOptions request(RequestOptions value) {
    return new VariableEnvironmentOptions(environment, value);
  }
}
