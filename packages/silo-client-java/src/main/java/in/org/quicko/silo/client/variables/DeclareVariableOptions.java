package in.org.quicko.silo.client.variables;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What {@code declare()} accepts. {@code environment} is where an initial
 * {@code value} lands, when one is given at all.
 */
public record DeclareVariableOptions(
    String description, String environment, String value, RequestOptions request) {

  public DeclareVariableOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static DeclareVariableOptions none() {
    return new DeclareVariableOptions(null, null, null, RequestOptions.none());
  }

  public DeclareVariableOptions description(String text) {
    return new DeclareVariableOptions(text, environment, value, request);
  }

  public DeclareVariableOptions environment(String name) {
    return new DeclareVariableOptions(description, name, value, request);
  }

  public DeclareVariableOptions value(String initial) {
    return new DeclareVariableOptions(description, environment, initial, request);
  }

  public DeclareVariableOptions request(RequestOptions value) {
    return new DeclareVariableOptions(description, environment, this.value, value);
  }
}
