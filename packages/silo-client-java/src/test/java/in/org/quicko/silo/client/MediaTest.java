package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.media.MediaAsset;
import in.org.quicko.silo.client.media.MediaDeleteReport;
import in.org.quicko.silo.client.media.MediaQuery;
import in.org.quicko.silo.client.media.MediaReference;
import in.org.quicko.silo.client.media.MediaState;
import in.org.quicko.silo.client.media.MediaUpload;
import in.org.quicko.silo.client.media.MediaUsagePage;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.support.RecordedRequest;
import in.org.quicko.silo.client.support.StubHttp;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.OptionalInt;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MediaTest {
  private static final String Asset =
      "{\"id\":\"m1\",\"filename\":\"logo.png\",\"folder\":\"brand\",\"blob_key\":\"ab/cd.png\","
          + "\"size\":2048,\"content_type\":\"image/png\",\"hash\":\"deadbeef\",\"state\":\"active\","
          + "\"tags\":[\"brand\"],\"url\":\"http://silo.test/media/m1\","
          + "\"created_at\":\"2026-09-01T10:00:00.000Z\",\"updated_at\":\"2026-09-01T10:00:00.000Z\","
          + "\"usage_count\":2}";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private Silo silo() {
    return server.silo("k");
  }

  @Test
  void mapsOnlyTheWireFieldsItKnows() {
    server.enqueueJson(Asset);
    MediaAsset asset = silo().media().get("m1");

    assertEquals(2048, asset.sizeInBytes());
    assertEquals("image/png", asset.contentType());
    assertEquals("ab/cd.png", asset.blobKey());
    assertEquals(MediaState.ACTIVE, asset.state());
    assertEquals(List.of("brand"), asset.tags());
    assertEquals(Instant.parse("2026-09-01T10:00:00Z"), asset.createdAt());
  }

  @Test
  void answersTheReferenceAnEntryShouldHoldRatherThanTheUrl() {
    server.enqueueJson(Asset);
    MediaAsset asset = silo().media().get("m1");

    assertEquals("silo://media/m1", asset.reference());
    assertEquals("m1", MediaReference.idOf(asset.reference()));
    assertNull(MediaReference.idOf(asset.url()), "a URL is not a reference, even a correct one");
  }

  @Test
  void sendsAnUploadAsMultipartWithTheFilenameTheServerReadsTheExtensionOff() {
    server.enqueueJson(Asset);
    silo().media().upload(
        MediaUpload.of("bytes".getBytes(StandardCharsets.UTF_8), "logo.png").folder("brand"));

    RecordedRequest request = server.lastRequest();
    assertEquals("POST", request.method());
    assertEquals("/api/media", request.path());
    assertTrue(request.contentType().startsWith("multipart/form-data"));
    assertTrue(request.body().contains("filename=\"logo.png\""), request.body());
    assertTrue(request.body().contains("name=\"folder\""), request.body());
  }

  @Test
  void refusesAnUploadWithNoFilenameRatherThanSendingOneCalledBlob() {
    assertThrows(IllegalArgumentException.class,
        () -> silo().media().upload(MediaUpload.of(new byte[] {1}, "  ")));
  }

  @Test
  void adoptsTheServersAnswerInPlaceAfterAReplace() {
    server.enqueueJson(Asset);
    MediaAsset asset = silo().media().get("m1");

    server.enqueueJson(Asset.replace("\"size\":2048", "\"size\":4096")
        .replace("\"hash\":\"deadbeef\"", "\"hash\":\"cafebabe\""));
    asset.replace(in.org.quicko.silo.client.media.MediaReplace.of(
        "new".getBytes(StandardCharsets.UTF_8), "logo.png"));

    assertEquals("/api/media/m1/content", server.lastRequest().path());
    assertEquals(4096, asset.sizeInBytes());
    assertEquals("cafebabe", asset.hash());
    assertEquals("silo://media/m1", asset.reference(), "the reference survives a replace");
  }

  @Test
  void translatesTheQueryOntoTheWiresOwnNames() {
    server.enqueueJson("{\"items\":[" + Asset + "],\"total\":1,\"limit\":50,\"offset\":0}");
    silo().media().list(MediaQuery.all()
        .text("logo")
        .extension("png")
        .modifiedAfter(Instant.parse("2026-01-01T00:00:00Z")));

    String target = server.lastRequest().target();
    assertTrue(target.contains("q=logo"), target);
    assertTrue(target.contains("ext=png"), target);
    assertTrue(target.contains("modified_after=2026-01-01T00%3A00%3A00Z"), target);
  }

  @Test
  void pagesUsagesByWhatThisKeyMaySeeRatherThanByTheTrueTotal() {
    server.enqueueJson(Asset);
    MediaAsset asset = silo().media().get("m1");

    server.enqueueJson("{\"items\":[{\"media_id\":\"m1\",\"project\":\"acme\",\"env\":\"prod\","
        + "\"collection\":\"posts\",\"entry_id\":\"e1\"}],\"total\":9,\"visible\":1,"
        + "\"visible_capped\":true}");
    MediaUsagePage usages = asset.usages();

    assertEquals(9, usages.total(), "the true referrer count is still reported");
    assertEquals(1, usages.visible());
    assertTrue(usages.visibleCapped());
    assertEquals(OptionalInt.of(1), usages.pageCount(), "the count derives from what is visible");
    assertFalse(usages.hasMore());
    assertEquals("prod", usages.usages().get(0).environment());
  }

  @Test
  void reportsEveryIdsOutcomeRatherThanThrowingOnAPartialBulkDelete() {
    server.enqueueJson("{\"deleted\":[\"m1\"],\"failed\":[{\"id\":\"m2\",\"code\":\"media_in_use\","
        + "\"message\":\"still referenced\",\"usage_count\":2,\"visible_count\":2,"
        + "\"visible_capped\":false,\"referrers\":[]}]}");

    MediaDeleteReport report = silo().media().deleteMany(List.of("m1", "m2"), DeleteOptions.none());

    assertEquals(List.of("m1"), report.deleted());
    assertEquals("media_in_use", report.failed().get(0).code());
    assertEquals(2, report.failed().get(0).usageCount());
  }

  @Test
  void refusesMoreIdsThanTheServerWouldTakeBeforeSendingThem() {
    List<String> tooMany = java.util.stream.IntStream.range(0, 101)
        .mapToObj(index -> "m" + index)
        .toList();

    assertThrows(IllegalArgumentException.class, () -> silo().media().deleteMany(tooMany));
    assertEquals(0, server.requestCount());
  }
}
