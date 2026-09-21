package in.org.quicko.silo.client.entries;

import java.time.Instant;

/**
 * One entry: the envelope silo puts on every row, and the author's own fields.
 *
 * <p>This is a plain value. It carries no transport, no scope and no behaviour,
 * so it logs as its own contents and drops into a cache or a DTO as-is. Writes
 * go through the collection — {@code posts.replace(id, rev, fields)},
 * {@code posts.delete(id, rev)} — where the revision being sent is visible at
 * the call site instead of hidden inside an object.
 *
 * <p>The wire's row is flat: the envelope's four keys sit beside the author's.
 * Java cannot express a type that is both {@code Post} and an envelope, so the
 * two are split here and {@link EntryMapper} is the one place that splits them.
 * Nothing is renamed on either side of that line.
 */
public record Entry<F>(String id, long rev, Instant createdAt, Instant updatedAt, F fields) {}
