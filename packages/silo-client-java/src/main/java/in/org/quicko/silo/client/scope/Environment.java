package in.org.quicko.silo.client.scope;

/**
 * An environment as the listing and create routes answer it. {@code id} is the
 * record's ULID and never changes; {@code name} is what every path addresses.
 */
public record Environment(String id, String name) {}
