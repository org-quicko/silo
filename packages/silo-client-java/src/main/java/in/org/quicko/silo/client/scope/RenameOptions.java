package in.org.quicko.silo.client.scope;

import in.org.quicko.silo.client.RequestOptions;

/**
 * What {@code rename()} accepts across projects, environments and collections.
 *
 * <p>{@code expectedId} binds the call to the record a caller already read —
 * from a dry run's report, from a listing, or supplied directly — so a rename
 * cannot land on a different record that has since taken the name.
 */
public record RenameOptions(String expectedId, boolean dryRun, RequestOptions request) {

  public RenameOptions {
    request = request == null ? RequestOptions.none() : request;
  }

  public static RenameOptions none() {
    return new RenameOptions(null, false, RequestOptions.none());
  }

  /** Answers what the rename would do, and changes nothing. Named
   *  {@code preview} because the record's own {@code dryRun()} accessor already
   *  has that name and no arguments. */
  public static RenameOptions preview() {
    return new RenameOptions(null, true, RequestOptions.none());
  }

  public RenameOptions expectedId(String value) {
    return new RenameOptions(value, dryRun, request);
  }

  public RenameOptions dryRun(boolean value) {
    return new RenameOptions(expectedId, value, request);
  }

  public RenameOptions request(RequestOptions value) {
    return new RenameOptions(expectedId, dryRun, value);
  }
}
