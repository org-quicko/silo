package in.org.quicko.silo.client.errors;

/**
 * One field-level validation failure: a JSON Pointer path plus the message the
 * validator raised, exactly as the wire's {@code error.details} carries it.
 */
public record ValidationDetail(String path, String message) {}
