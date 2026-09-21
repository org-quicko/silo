package in.org.quicko.silo.client.entries;

/**
 * Whether a read answers the stored {@code {{NAME}}} templates or what they
 * resolve to in this environment.
 *
 * <p>{@link #RESOLVED} is the default, because an application reading content
 * should not have to opt in to a usable value. An editor wants {@link #RAW}:
 * seeding a form with a resolved value and saving it back replaces the reference
 * somebody typed with a snapshot of what it meant in one environment on one day,
 * and a template cannot be recovered from its substitution.
 */
public enum VariableResolution {
  RESOLVED,
  RAW;

  /** What goes on the wire, or null when the default already says it. */
  public String wireValue() {
    return this == RAW ? "raw" : null;
  }
}
