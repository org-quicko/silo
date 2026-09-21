package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.collections.CollectionSummary;
import in.org.quicko.silo.client.errors.NotFoundException;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.scope.Project;
import in.org.quicko.silo.client.scope.ProjectHandle;
import in.org.quicko.silo.client.scope.RenameOptions;
import in.org.quicko.silo.client.scope.RenameReport;
import in.org.quicko.silo.client.support.StubHttp;
import in.org.quicko.silo.client.variables.Variable;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ScopeTest {
  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private Silo silo() {
    return server.silo("k");
  }

  @Test
  void aHandleMakesNoRequestUntilTheCallAtTheEndOfTheChain() {
    silo().project("acme").environment("prod").collection("posts");
    assertEquals(0, server.requestCount());
  }

  @Test
  void listsProjectsByIdAndName() {
    server.enqueueJson("{\"items\":[{\"id\":\"01P\",\"name\":\"acme\"}]}");
    List<Project> projects = silo().projects().list();

    assertEquals(List.of(new Project("01P", "acme")), projects);
  }

  @Test
  void readsARenameReportAndTheIdThatBindsTheRealCallToIt() {
    server.enqueueJson("{\"id\":\"01P\",\"from\":\"acme\",\"to\":\"acme-corp\","
        + "\"rewritten_claims\":[\"collections:acme/*/*:entries:read\"],"
        + "\"pattern_affected_claims\":[\"collections:acm*/*/*:entries:read\"]}");

    RenameReport report = silo().project("acme").rename("acme-corp", RenameOptions.preview());

    assertEquals("01P", report.id());
    assertEquals(List.of("collections:acme/*/*:entries:read"), report.rewrittenClaims());
    assertEquals(List.of("collections:acm*/*/*:entries:read"), report.patternAffectedClaims());
    assertTrue(server.lastRequest().target().contains("dry_run=true"));
  }

  @Test
  void aHandleKeepsAddressingTheNameItWasBuiltWith() {
    server.enqueueJson("{\"id\":\"01P\",\"from\":\"acme\",\"to\":\"acme-corp\","
        + "\"rewritten_claims\":[],\"pattern_affected_claims\":[]}");
    ProjectHandle handle = silo().project("acme");
    handle.rename("acme-corp");

    server.enqueue(404, "application/json",
        "{\"error\":{\"code\":\"not_found\",\"message\":\"no project named acme\"}}");

    assertThrows(NotFoundException.class, () -> handle.delete());
    assertEquals("/api/projects/acme", server.lastRequest().path());
  }

  @Test
  void sendsForceOnlyWhenItWasAskedFor() {
    server.enqueueNoContent();
    silo().project("acme").delete();
    assertEquals("/api/projects/acme", server.lastRequest().target());

    server.enqueueNoContent();
    silo().project("acme").delete(DeleteOptions.forced());
    assertEquals("/api/projects/acme?force=true", server.lastRequest().target());
  }

  @Test
  void mapsOnlyTheCollectionMetadataItKnows() {
    server.enqueueJson("{\"items\":[{\"id\":\"01C\",\"name\":\"posts\",\"entries\":42,"
        + "\"requires_auth\":true,\"created_at\":\"2026-09-01T10:00:00.000Z\","
        + "\"updated_at\":\"2026-09-02T10:00:00.000Z\"}]}");

    CollectionSummary summary = silo().scope("acme", "prod").collections().list().get(0);

    assertEquals(42, summary.entries());
    assertTrue(summary.requiresAuth());
    assertEquals(Instant.parse("2026-09-02T10:00:00Z"), summary.updatedAt());
  }

  @Test
  void tellsAnUnsetVariableValueFromAnEmptyOne() {
    server.enqueueJson("{\"items\":["
        + "{\"name\":\"API_URL\",\"description\":\"\",\"value\":null,\"set_in\":0,"
        + "\"created_at\":\"2026-09-01T10:00:00.000Z\",\"updated_at\":\"2026-09-01T10:00:00.000Z\"},"
        + "{\"name\":\"BANNER\",\"description\":\"\",\"value\":\"\",\"set_in\":1,"
        + "\"created_at\":\"2026-09-01T10:00:00.000Z\",\"updated_at\":\"2026-09-01T10:00:00.000Z\"}]}");

    List<Variable> variables = silo().scope("acme", "prod").variables().list();

    assertTrue(variables.get(0).value().isEmpty(), "an unset value leaves the reference standing");
    assertEquals("", variables.get(1).value().orElseThrow(), "an empty value is one somebody chose");
  }
}
