package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.collections.CollectionHandle;
import in.org.quicko.silo.client.support.StubHttp;
import in.org.quicko.silo.client.trash.TrashContentsQuery;
import in.org.quicko.silo.client.trash.TrashKind;
import in.org.quicko.silo.client.trash.TrashPage;
import in.org.quicko.silo.client.trash.TrashParkedRecords;
import in.org.quicko.silo.client.trash.TrashQuery;
import in.org.quicko.silo.client.trash.TrashRecord;
import in.org.quicko.silo.client.trash.TrashRestoreOptions;
import in.org.quicko.silo.client.trash.TrashRestoreResult;
import in.org.quicko.silo.client.trash.TrashState;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TrashTest {
  private static final String Receipt =
      "{\"id\":\"t1\",\"kind\":\"media_folder\","
          + "\"origin\":{\"project_id\":\"p1\",\"project_name\":\"acme\",\"env_id\":\"e1\",\"env_name\":\"prod\"},"
          + "\"subject_id\":\"a1\",\"subject_name\":\"hello-world\","
          + "\"deleted_at\":\"2026-10-01T10:00:00Z\","
          + "\"deleted_by\":{\"kind\":\"key\",\"id\":\"k1\",\"label\":\"editor\"},"
          + "\"expires_at\":null,"
          + "\"contents\":{\"collections\":0,\"entries\":1,\"assets\":0,\"bytes\":0},"
          + "\"media_refs\":[\"m1\"],\"state\":\"parked\",\"restorable\":false,"
          + "\"blocked_by\":{\"kind\":\"environment\",\"name\":\"prod\",\"trash_id\":\"t0\"}}";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  private Silo silo() {
    return server.silo("k");
  }

  @Test
  void answersTheReceiptIdAnEntryDeleteLeftAndEmptyWhenNothingWasKept() {
    CollectionHandle<Map<String, Object>> posts = silo().scope("acme", "prod").collection("posts");

    server.enqueueNoContent(Map.of("X-Silo-Trash-Id", "t1"));
    assertEquals(Optional.of("t1"), posts.delete("e1", 3));
    assertEquals("/api/projects/acme/envs/prod/collections/posts/e1?rev=3", server.lastRequest().target());

    server.enqueueNoContent();
    assertEquals(Optional.empty(), posts.delete("e2", 1));
  }

  @Test
  void listsOnTheWireNamesReadsAReceiptAndPagesWithTheSameFilters() {
    server.enqueueJson("{\"items\":[" + Receipt + "],\"total\":3,\"limit\":1,\"offset\":0}");
    TrashPage first = silo().trash().list(TrashQuery.all()
        .kind(TrashKind.MEDIA_FOLDER)
        .environment("prod")
        .deletedAfter(Instant.parse("2026-10-01T00:00:00Z"))
        .limit(1));

    assertEquals(
        "/api/trash?kind=media_folder&env=prod&deleted_after=2026-10-01T00%3A00%3A00Z&limit=1&offset=0",
        server.lastRequest().target());

    TrashRecord item = first.items().get(0);
    assertEquals(TrashKind.MEDIA_FOLDER, item.kind());
    assertEquals("prod", item.origin().environmentName());
    assertEquals("editor", item.deletedBy().label());
    assertEquals(Instant.parse("2026-10-01T10:00:00Z"), item.deletedAt());
    assertEquals(Optional.empty(), item.expiresAt());
    assertEquals(1, item.contents().entries());
    assertEquals(TrashState.PARKED, item.state());
    assertFalse(item.restorable());
    assertEquals(TrashKind.ENVIRONMENT, item.blockedBy().orElseThrow().kind());
    assertEquals(Optional.of("t0"), item.blockedBy().orElseThrow().trashId());

    server.enqueueJson("{\"items\":[],\"total\":3,\"limit\":1,\"offset\":1}");
    first.next();
    String target = server.lastRequest().target();
    assertTrue(target.contains("kind=media_folder"), target);
    assertTrue(target.contains("offset=1"), target);
  }

  @Test
  void readsWhatOneReceiptParked() {
    server.enqueueJson(
        "{\"items\":[{\"trash_id\":\"t1\",\"kind\":\"entry\",\"record\":{\"id\":\"e1\"}}],\"total\":1}");
    TrashParkedRecords parked =
        silo().trash().contents("t1", TrashContentsQuery.all().limit(25), RequestOptions.none());

    assertEquals("/api/trash/t1/items?limit=25", server.lastRequest().target());
    assertEquals(1, parked.total());
    assertEquals("entry", parked.records().get(0).path("kind").asText());
  }

  @Test
  void aRestoreSendsTheRenameAndTheChainAndReadsWhatCameBack() {
    server.enqueueJson("{\"restored\":[\"t0\",\"t1\"],\"projects\":0,\"environments\":1,"
        + "\"collections\":0,\"entries\":1,\"assets\":0,\"broken_media_refs\":[\"m1\"],"
        + "\"renamed_to\":\"hello-world-2\"}");
    TrashRestoreResult result = silo().trash().restore(
        "t1", TrashRestoreOptions.none().rename("hello-world-2").chain(true));

    assertEquals("POST", server.lastRequest().method());
    assertEquals("/api/trash/t1/restore", server.lastRequest().path());
    assertEquals("{\"rename\":\"hello-world-2\",\"chain\":true}", server.lastRequest().body());
    assertEquals(List.of("t0", "t1"), result.restored());
    assertEquals(List.of("m1"), result.brokenMediaRefs());
    assertEquals(Optional.of("hello-world-2"), result.renamedTo());
  }

  @Test
  void purgesOneReceiptAndEmptiesWithTheConfirmationWord() {
    server.enqueueNoContent();
    silo().trash().purge("t1");
    assertEquals("DELETE", server.lastRequest().method());
    assertEquals("/api/trash/t1", server.lastRequest().path());

    server.enqueueJson("{\"purged\":4}");
    assertEquals(4, silo().trash().empty());
    assertEquals("/api/trash/purge", server.lastRequest().path());
    assertEquals("{\"confirm\":\"empty\"}", server.lastRequest().body());
  }
}
