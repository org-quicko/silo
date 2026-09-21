package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Holds this client's route inventory to the TypeScript client's, which is in
 * turn checked against the server's own route registrations.
 *
 * <p>Reading the sibling package rather than {@code docs/guide/http-api.md} is
 * deliberate: a drift guard reading a document that can be incomplete, and has
 * been, is false confidence. The test skips when the tree above is absent, so
 * the package still builds when it is consumed on its own.
 */
class RouteInventoryDriftTest {
  private static final Path TypeScriptInventory =
      Path.of("..", "silo-client", "src", "transport", "route-inventory.ts");

  private static final Pattern QuotedString = Pattern.compile("\"([^\"]+)\"");

  @org.junit.jupiter.api.Test
  void coversExactlyWhatTheTypeScriptClientCovers() {
    String source = read();
    assertEquals(
        between(source, "Covered: readonly string[] = [", "];"),
        Set.copyOf(RouteInventory.Covered),
        "the two clients must reach the same routes, or the difference must be deliberate");
  }

  @org.junit.jupiter.api.Test
  void leavesOutExactlyWhatTheTypeScriptClientLeavesOut() {
    String source = read();
    assertEquals(
        keysOf(between(source, "OutOfScope: Readonly<Record<string, string>> = {", "};")),
        RouteInventory.OutOfScope.keySet(),
        "a route in neither list is a gap in one of the two clients");
  }

  /** The reasons are prose and are allowed to differ; the keys are the contract. */
  private static Set<String> keysOf(Set<String> quoted) {
    Set<String> keys = new LinkedHashSet<>();
    for (String candidate : quoted) {
      if (candidate.matches("^(GET|POST|PUT|PATCH|DELETE|ALL) /.*")) keys.add(candidate);
    }
    return keys;
  }

  private static Set<String> between(String source, String opening, String closing) {
    int start = source.indexOf(opening);
    int end = source.indexOf(closing, start);
    Matcher matcher = QuotedString.matcher(source.substring(start + opening.length(), end));

    Set<String> found = new LinkedHashSet<>();
    while (matcher.find()) {
      found.add(matcher.group(1));
    }
    return found;
  }

  private static String read() {
    assumeTrue(
        Files.isRegularFile(TypeScriptInventory),
        "the TypeScript client is not checked out beside this package");
    try {
      return Files.readString(TypeScriptInventory, StandardCharsets.UTF_8);
    } catch (IOException caught) {
      throw new UncheckedIOException("could not read " + TypeScriptInventory, caught);
    }
  }
}
