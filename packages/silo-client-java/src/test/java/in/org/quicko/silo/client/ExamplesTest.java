package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.collections.CollectionDefinition;
import in.org.quicko.silo.client.collections.CollectionHandle;
import in.org.quicko.silo.client.collections.CollectionSummary;
import in.org.quicko.silo.client.collections.JsonSchema;
import in.org.quicko.silo.client.entries.Entry;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.scope.Environment;
import in.org.quicko.silo.client.scope.EnvironmentHandle;
import in.org.quicko.silo.client.scope.Project;
import in.org.quicko.silo.client.scope.ProjectHandle;
import in.org.quicko.silo.client.scope.RenameOptions;
import in.org.quicko.silo.client.scope.RenameReport;
import in.org.quicko.silo.client.search.SearchEngine;
import in.org.quicko.silo.client.search.SearchHit;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.support.StubHttp;
import in.org.quicko.silo.client.variables.DeclareVariableOptions;
import in.org.quicko.silo.client.variables.Variable;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The README's examples, run.
 *
 * <p>Each test is one block of `README.md`, typed out as the README types it,
 * so an example cannot drift from the API without the build saying so. The
 * media blocks are in {@link MediaExamplesTest} for the reason the README puts
 * them in a section of their own.
 */
class ExamplesTest {

  /** The README's field type, a record, which is also the claim that one works. */
  record Post(String title, String status, List<String> tags) {}

  private static final String Schema = """
      {"type":"object","required":["title","status"],"properties":{
        "title":{"type":"string"},
        "status":{"type":"string","enum":["draft","published"]},
        "tags":{"type":"array","items":{"type":"string"}}}}
      """;

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private static String row(String id, int rev, String status) {
    return "{\"id\":\"" + id + "\",\"rev\":" + rev
        + ",\"created_at\":\"2026-09-01T10:00:00.000Z\""
        + ",\"updated_at\":\"2026-09-02T10:00:00.000Z\""
        + ",\"title\":\"Hello\",\"status\":\"" + status + "\",\"tags\":[\"intro\"]}";
  }

  @Test
  void gettingStarted() {
    server.enqueueJson("{\"status\":\"ok\",\"version\":\"1.1.0\"}");
    server.enqueueJson("{\"id\":\"01C\",\"name\":\"posts\",\"schema\":" + Schema + "}");
    server.enqueueJson(row("01ABC", 1, "draft"));
    server.enqueueJson(row("01ABC", 2, "published"));
    server.enqueueJson("{\"data\":[" + row("01ABC", 2, "published") + "],\"total\":1,\"limit\":50,\"offset\":0}");
    server.enqueueNoContent();

    Silo silo = server.silo("silo_key_abc");

    assertEquals("1.1.0", silo.health().version());

    EnvironmentHandle prod = silo.scope("acme", "prod");
    prod.collections().create("posts", JsonSchema.parse(Schema));

    CollectionHandle<Post> posts = prod.collection("posts", Post.class);

    Entry<Post> created = posts.create(new Post("Hello", "draft", List.of("intro")));
    Entry<Post> published = posts.replace(
        created.id(), created.rev(), new Post("Hello", "published", List.of("intro")));

    List<String> titles = new ArrayList<>();
    for (Entry<Post> post : posts.all()) {
      titles.add(post.fields().title());
    }

    posts.delete(published.id(), published.rev());

    assertEquals("draft", created.fields().status(), "a record binds as the field type");
    assertEquals(2, published.rev());
    assertEquals(List.of("Hello"), titles);
    assertEquals(6, server.requestCount());
  }

  @Test
  void projectsAndEnvironments() {
    server.enqueueJson("{\"items\":[{\"id\":\"01P\",\"name\":\"acme\"}]}");
    server.enqueueJson("{\"id\":\"01P\",\"name\":\"acme\"}");
    server.enqueueJson("{\"items\":[{\"id\":\"01E\",\"name\":\"prod\"}]}");
    server.enqueueJson("{\"id\":\"01E2\",\"name\":\"staging\"}");

    Silo silo = server.silo("k");

    List<Project> projects = silo.projects().list();
    Project acme = silo.projects().create("acme");

    ProjectHandle project = silo.project("acme");
    List<Environment> environments = project.environments().list();
    project.environments().create("staging");

    assertEquals("acme", projects.get(0).name());
    assertEquals("01P", acme.id());
    assertEquals("prod", environments.get(0).name());
  }

  @Test
  void aRenameIsPreviewedThenBoundToWhatWasPreviewed() {
    String report = "{\"id\":\"01P\",\"from\":\"acme\",\"to\":\"acme-corp\","
        + "\"rewritten_claims\":[\"collections:acme/*/*:entries:read\"],"
        + "\"pattern_affected_claims\":[\"collections:acm*/*/*:entries:read\"]}";
    server.enqueueJson(report);
    server.enqueueJson(report);
    server.enqueueNoContent();

    ProjectHandle project = server.silo("k").project("acme");

    RenameReport preview = project.rename("acme-corp", RenameOptions.preview());
    assertEquals(List.of("collections:acme/*/*:entries:read"), preview.rewrittenClaims());
    assertEquals(List.of("collections:acm*/*/*:entries:read"), preview.patternAffectedClaims());

    project.rename("acme-corp", RenameOptions.none().expectedId(preview.id()));

    assertTrue(server.request(0).target().contains("dry_run=true"));
    assertTrue(server.request(1).target().contains("expected_id=01P"));
    assertTrue(!server.request(1).target().contains("dry_run"));

    server.silo("k").project("acme").environment("staging").delete(DeleteOptions.forced());
    assertEquals("/api/projects/acme/envs/staging?force=true", server.lastRequest().target());
  }

  @Test
  void collectionsAndSchemas() {
    server.enqueueJson("{\"items\":[{\"id\":\"01C\",\"name\":\"posts\",\"entries\":42,"
        + "\"requires_auth\":true,\"created_at\":\"2026-09-01T10:00:00.000Z\","
        + "\"updated_at\":\"2026-09-02T10:00:00.000Z\"}]}");
    server.enqueueJson("{\"id\":\"01C\",\"name\":\"posts\",\"schema\":" + Schema + "}");
    server.enqueueJson("{\"items\":[{\"id\":\"01C\",\"name\":\"posts\",\"schema\":" + Schema + "}]}");
    server.enqueueJson("{\"id\":\"01C\",\"name\":\"posts\",\"schema\":" + Schema + "}");
    server.enqueueNoContent();

    EnvironmentHandle prod = server.silo("k").scope("acme", "prod");

    List<CollectionSummary> summaries = prod.collections().list();
    assertEquals(42, summaries.get(0).entries());

    CollectionDefinition definition = prod.collection("posts").schema().get();
    List<CollectionDefinition> everySchema = prod.schemas();
    assertEquals("posts", definition.name());
    assertEquals(1, everySchema.size());

    prod.collection("posts").schema().put(JsonSchema.parse(Schema));
    prod.collection("posts").schema().delete(DeleteOptions.forced());

    assertEquals("/api/projects/acme/envs/prod/collections/posts/schema?force=true",
        server.lastRequest().target());
  }

  @Test
  void variablesAreDeclaredOncePerProjectAndValuedPerEnvironment() {
    String declaration = "{\"name\":\"API_URL\",\"description\":\"Where the public API lives\","
        + "\"value\":\"https://api.acme.com\",\"set_in\":1,"
        + "\"created_at\":\"2026-09-01T10:00:00.000Z\",\"updated_at\":\"2026-09-01T10:00:00.000Z\"}";
    server.enqueueJson(declaration);
    server.enqueueJson(declaration.replace("https://api.acme.com", "https://api.staging.acme.com"));
    server.enqueueJson("{\"items\":[" + declaration + ",{\"name\":\"BANNER\",\"description\":\"\","
        + "\"value\":null,\"set_in\":0,\"created_at\":\"2026-09-01T10:00:00.000Z\","
        + "\"updated_at\":\"2026-09-01T10:00:00.000Z\"}]}");
    server.enqueueJson(declaration);
    server.enqueueNoContent();

    Silo silo = server.silo("k");

    silo.project("acme").variables().declare("API_URL",
        DeclareVariableOptions.none()
            .description("Where the public API lives")
            .environment("prod")
            .value("https://api.acme.com"));

    silo.scope("acme", "staging").variables().set("API_URL", "https://api.staging.acme.com");

    List<Variable> variables = silo.scope("acme", "prod").variables().list();
    assertEquals("https://api.acme.com", variables.get(0).value().orElse("(unset)"));
    assertEquals("(unset)", variables.get(1).value().orElse("(unset)"),
        "an unset value leaves the reference standing, and is not an empty string");

    silo.scope("acme", "staging").variables().unset("API_URL");
    silo.project("acme").variables().undeclare("API_URL");

    assertEquals("/api/projects/acme/variables/API_URL", server.lastRequest().target());
  }

  @Test
  void searchReachIsTheReceiver() {
    String hit = "{\"project\":\"acme\",\"env\":\"prod\",\"collection\":\"posts\",\"entry\":"
        + row("01ABC", 1, "published") + ",\"snippets\":[{\"path\":\"$.data.title\","
        + "\"before\":\"\",\"match\":\"release notes\",\"after\":\" for 1.1\"}]}";
    String body = "{\"data\":[" + hit + "],\"total\":1,\"limit\":20,\"offset\":0,\"engine\":\"fts5\"}";
    server.enqueueJson(body);
    server.enqueueJson(body);
    server.enqueueJson(body);

    Silo silo = server.silo("k");
    SearchQuery query = SearchQuery.matching("release notes").limit(20);

    SearchPage page = silo.search(query);
    for (SearchHit found : page.hits()) {
      assertEquals("prod", found.environment());
      assertEquals("release notes", found.snippets().get(0).match());
    }

    silo.scope("acme", "prod").search(query);
    silo.scope("acme", "prod").collection("posts").search(query);

    assertEquals("/api/search", server.request(0).path());
    assertEquals("/api/projects/acme/envs/prod/search", server.request(1).path());
    assertEquals("/api/projects/acme/envs/prod/collections/posts/search", server.request(2).path());
  }

  @Test
  void aTruncatedSearchWillNotGuessAPageCount() {
    server.enqueueJson("{\"data\":[],\"total\":0,\"limit\":20,\"offset\":0,"
        + "\"engine\":\"scan\",\"truncated\":true}");

    SearchPage page = server.silo("k").search(SearchQuery.matching("release notes").limit(20));

    assertTrue(page.truncated());
    assertTrue(page.pageCount().isEmpty(), "the total is a scan's count, not a real one");
    assertEquals(SearchEngine.SCAN, page.engine());
  }
}
