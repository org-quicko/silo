package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.errors.MediaInUseException;
import in.org.quicko.silo.client.media.MediaAsset;
import in.org.quicko.silo.client.media.MediaDeleteReport;
import in.org.quicko.silo.client.media.MediaFolderDeleteOptions;
import in.org.quicko.silo.client.media.MediaFolderMoveOptions;
import in.org.quicko.silo.client.media.MediaFolders;
import in.org.quicko.silo.client.media.MediaPage;
import in.org.quicko.silo.client.media.MediaQuery;
import in.org.quicko.silo.client.media.MediaReplace;
import in.org.quicko.silo.client.media.MediaUpload;
import in.org.quicko.silo.client.media.MediaUsagePage;
import in.org.quicko.silo.client.support.StubHttp;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The README's media examples, run. Its siblings are in {@link ExamplesTest}. */
class MediaExamplesTest {
  private static final String Asset =
      "{\"id\":\"m1\",\"filename\":\"logo.png\",\"folder\":\"brand\",\"blob_key\":\"ab/cd.png\","
          + "\"size\":2048,\"content_type\":\"image/png\",\"hash\":\"deadbeef\",\"state\":\"active\","
          + "\"tags\":[\"brand\"],\"url\":\"https://silo.example.com/media/m1\","
          + "\"created_at\":\"2026-09-01T10:00:00.000Z\",\"updated_at\":\"2026-09-01T10:00:00.000Z\","
          + "\"usage_count\":2}";

  private StubHttp server;

  @TempDir
  Path workspace;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private Path file(String name) throws IOException {
    Path path = workspace.resolve(name);
    Files.write(path, "bytes".getBytes(StandardCharsets.UTF_8));
    return path;
  }

  @Test
  void anEntryStoresTheReferenceAndNeverTheUrl() throws IOException {
    server.enqueueJson(Asset);

    MediaAsset logo = server.silo("k").media().upload(
        MediaUpload.of(file("logo.png")).folder("brand"));

    assertEquals("silo://media/m1", logo.reference());
    assertTrue(logo.url().endsWith("/media/m1"));
    assertTrue(server.lastRequest().body().contains("filename=\"logo.png\""));
    assertTrue(server.lastRequest().body().contains("name=\"folder\""));
  }

  @Test
  void aMutatingCallAdoptsTheServersAnswerInPlace() {
    server.enqueueJson(Asset);
    server.enqueueJson(Asset.replace("logo.png", "logo-2026.png"));
    server.enqueueJson(Asset.replace("\"folder\":\"brand\"", "\"folder\":\"brand/archive\""));
    server.enqueueJson(Asset.replace("[\"brand\"]", "[\"brand\",\"archived\"]"));

    MediaAsset asset = server.silo("k").media().get("m1");

    asset.rename("logo-2026.png");
    assertEquals("logo-2026.png", asset.filename());

    asset.moveTo("brand/archive");
    assertEquals("brand/archive", asset.folder());

    asset.setTags(List.of("brand", "archived"));
    assertEquals(List.of("brand", "archived"), asset.tags());
  }

  @Test
  void replacingTheBytesKeepsTheReferenceAndMovesTheHash() throws IOException {
    server.enqueueJson(Asset);
    server.enqueueJson(Asset
        .replace("\"size\":2048", "\"size\":4096")
        .replace("\"hash\":\"deadbeef\"", "\"hash\":\"cafebabe\""));

    MediaAsset asset = server.silo("k").media().get("m1");
    asset.replace(MediaReplace.of(file("logo-v2.png")));

    assertEquals("cafebabe", asset.hash());
    assertEquals(4096, asset.sizeInBytes());
    assertEquals("silo://media/m1", asset.reference(), "the reference survives a replace");
    assertEquals("/api/media/m1/content", server.lastRequest().path());
  }

  @Test
  void listingTakesAQueryAndPagesLazily() {
    server.enqueueJson("{\"items\":[" + Asset + "],\"total\":1,\"limit\":50,\"offset\":0}");
    server.enqueueJson("{\"items\":[" + Asset + "],\"total\":1,\"limit\":50,\"offset\":0}");
    server.enqueueJson("{\"items\":[\"png\",\"svg\"]}");

    MediaPage page = server.silo("k").media().list(MediaQuery.all()
        .folder("brand")
        .recursive(true)
        .extension("png")
        .modifiedAfter(Instant.now().minus(Duration.ofDays(30))));
    assertEquals(1, page.files().size());

    String target = server.request(0).target();
    assertTrue(target.contains("folder=brand"), target);
    assertTrue(target.contains("recursive=true"), target);
    assertTrue(target.contains("ext=png"), target);
    assertTrue(target.contains("modified_after="), target);

    List<String> filenames = new ArrayList<>();
    for (MediaAsset file : server.silo("k").media().all(MediaQuery.all().text("logo"))) {
      filenames.add(file.filename());
    }
    assertEquals(List.of("logo.png"), filenames);

    assertEquals(List.of("png", "svg"), server.silo("k").media().extensions());
  }

  @Test
  void foldersAreExplicitRecords() {
    server.enqueueJson("{\"path\":\"brand/2026\"}");
    server.enqueueJson("{\"from\":\"brand/2026\",\"to\":\"brand/current\"}");
    server.enqueueNoContent();

    MediaFolders folders = server.silo("k").media().folders();

    assertEquals("brand/2026", folders.create("brand/2026"));
    assertEquals("brand/current",
        folders.rename("brand/2026", "brand/current", MediaFolderMoveOptions.merging()).to());
    assertTrue(server.request(1).body().contains("\"merge\":true"));

    folders.delete("brand/archive", MediaFolderDeleteOptions.recursively().force(true));
    String target = server.lastRequest().target();
    assertTrue(target.contains("path=brand%2Farchive"), target);
    assertTrue(target.contains("recursive=true"), target);
    assertTrue(target.contains("force=true"), target);
  }

  @Test
  void aRefusedDeleteCarriesTheFactsNeededToDecide() {
    server.enqueueJson(Asset);
    server.enqueue(409, "application/json",
        "{\"error\":{\"code\":\"media_in_use\",\"message\":\"still referenced\",\"details\":"
            + "{\"usage_count\":3,\"visible_count\":2,\"visible_capped\":true,\"referrers\":"
            + "[{\"media_id\":\"m1\",\"project\":\"acme\",\"env\":\"prod\","
            + "\"collection\":\"posts\",\"entry_id\":\"e1\"}]}}}");

    MediaAsset asset = server.silo("k").media().get("m1");

    MediaInUseException caught =
        assertThrows(MediaInUseException.class, () -> asset.delete());

    assertEquals(3, caught.usageCount());
    assertEquals(2, caught.visibleCount());
    assertTrue(caught.visibleCapped());
    assertEquals("posts", caught.referrers().get(0).collection());
  }

  @Test
  void usagesPageByWhatThisKeyMaySee() {
    server.enqueueJson(Asset);
    server.enqueueJson("{\"items\":[{\"media_id\":\"m1\",\"project\":\"acme\",\"env\":\"prod\","
        + "\"collection\":\"posts\",\"entry_id\":\"e1\"}],\"total\":9,\"visible\":1,"
        + "\"visible_capped\":false}");

    MediaUsagePage usages = server.silo("k").media().get("m1").usages();

    assertEquals(9, usages.total(), "the true referrer count");
    assertEquals(1, usages.visible(), "what this key is allowed to see");
  }

  @Test
  void aBulkDeleteAnswersAReportRatherThanThrowing() {
    server.enqueueJson("{\"deleted\":[\"m1\"],\"failed\":[{\"id\":\"m2\","
        + "\"code\":\"media_in_use\",\"message\":\"still referenced\",\"usage_count\":2,"
        + "\"visible_count\":2,\"visible_capped\":false,\"referrers\":[]}]}");

    MediaDeleteReport report = server.silo("k").media().deleteMany(List.of("m1", "m2"));

    assertEquals(List.of("m1"), report.deleted());
    assertEquals("m2", report.failed().get(0).id());
    assertEquals("media_in_use", report.failed().get(0).code());
  }
}
