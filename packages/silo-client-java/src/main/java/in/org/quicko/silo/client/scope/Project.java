package in.org.quicko.silo.client.scope;

/**
 * A project as the listing and create routes answer it. {@code id} is the
 * record's ULID and never changes; {@code name} is what every path addresses,
 * and can be renamed.
 */
public record Project(String id, String name) {}
