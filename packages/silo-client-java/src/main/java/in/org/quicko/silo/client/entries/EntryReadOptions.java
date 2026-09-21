package in.org.quicko.silo.client.entries;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What every entry read accepts on top of the cancellation options: whether the
 * {@code {{NAME}}} references in the answer are resolved or left standing.
 */
public record EntryReadOptions(VariableResolution variables, RequestOptions request) {

  public EntryReadOptions {
    variables = variables == null ? VariableResolution.RESOLVED : variables;
    request = request == null ? RequestOptions.none() : request;
  }

  /** Resolving, with no deadline and no cancellation: the ordinary read. */
  public static EntryReadOptions none() {
    return new EntryReadOptions(VariableResolution.RESOLVED, RequestOptions.none());
  }

  /** The stored templates rather than what they resolve to — what editing one
   *  requires. */
  public static EntryReadOptions raw() {
    return new EntryReadOptions(VariableResolution.RAW, RequestOptions.none());
  }

  public EntryReadOptions variables(VariableResolution value) {
    return new EntryReadOptions(value, request);
  }

  public EntryReadOptions request(RequestOptions value) {
    return new EntryReadOptions(variables, value);
  }
}
