package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import in.org.quicko.silo.client.errors.ConflictException;
import in.org.quicko.silo.client.errors.ForbiddenException;
import in.org.quicko.silo.client.errors.InvalidResponseException;
import in.org.quicko.silo.client.errors.MediaInUseException;
import in.org.quicko.silo.client.errors.NetworkException;
import in.org.quicko.silo.client.errors.NotFoundException;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import in.org.quicko.silo.client.errors.RequestTimeoutException;
import in.org.quicko.silo.client.errors.SiloException;
import in.org.quicko.silo.client.errors.UnauthorizedException;
import in.org.quicko.silo.client.errors.ValidationFailedException;
import in.org.quicko.silo.client.instance.HealthReport;
import in.org.quicko.silo.client.support.RecordedRequest;
import in.org.quicko.silo.client.support.StubHttp;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TransportTest {
  private static final String Health = "{\"status\":\"ok\",\"version\":\"1.1.0\"}";

  private StubHttp server;

  @BeforeEach
  void newStub() {
    server = StubHttp.create();
  }

  @Test
  void readsTheOneRouteThatIsNeverAuthenticated() {
    server.enqueueJson(Health);
    HealthReport report = server.anonymous().health();

    assertEquals("ok", report.status());
    assertEquals("1.1.0", report.version());
    assertEquals("/api/health", server.lastRequest().path());
  }

  @Test
  void sendsTheKeyAsABearerToken() {
    server.enqueueJson(Health);
    server.silo("silo_key_abc").health();

    assertEquals("Bearer silo_key_abc", server.lastRequest().header("authorization"));
  }

  @Test
  void sendsNoAuthorizationHeaderWithoutAKeyBecauseAnonymousReadsAreLegal() {
    server.enqueueJson(Health);
    server.anonymous().health();

    assertNull(server.lastRequest().header("authorization"));
  }

  @Test
  void stripsTrailingSlashesFromTheBaseUrlSoThePathIsNotDoubled() {
    server.enqueueJson(Health);
    new Silo(SiloOptions.of(StubHttp.BaseUrl + "///").httpClient(server.client())).health();

    assertEquals("/api/health", server.lastRequest().path());
  }

  @Test
  void sendsCallerHeadersAndKeepsAuthorizationItsOwn() {
    server.enqueueJson(Health);
    new Silo(SiloOptions.of(StubHttp.BaseUrl, "silo_key_abc")
        .headers(Map.of("X-Trace", "abc123", "Authorization", "Bearer wrong"))
        .httpClient(server.client()))
        .health();

    RecordedRequest request = server.lastRequest();
    assertEquals("abc123", request.header("x-trace"));
    assertEquals("Bearer silo_key_abc", request.header("authorization"));
  }

  @Test
  void raisesTheClassTheWireCodeNames() {
    assertInstanceOf(ValidationFailedException.class, refusal(400, "validation_failed"));
    assertInstanceOf(UnauthorizedException.class, refusal(401, "unauthorized"));
    assertInstanceOf(ForbiddenException.class, refusal(403, "forbidden"));
    assertInstanceOf(NotFoundException.class, refusal(404, "not_found"));
    assertInstanceOf(ConflictException.class, refusal(409, "conflict"));
  }

  @Test
  void carriesTheValidationDetailTheServerNamed() {
    server.enqueue(400, "application/json",
        "{\"error\":{\"code\":\"validation_failed\",\"message\":\"bad\",\"details\":"
            + "[{\"path\":\"/title\",\"message\":\"required\"}]}}");

    ValidationFailedException caught =
        assertThrows(ValidationFailedException.class, () -> server.silo("k").health());

    assertEquals(1, caught.details().size());
    assertEquals("/title", caught.details().get(0).path());
    assertEquals("required", caught.details().get(0).message());
  }

  @Test
  void readsTheObjectShapedDetailsOfAMediaInUseRefusal() {
    server.enqueue(409, "application/json",
        "{\"error\":{\"code\":\"media_in_use\",\"message\":\"still referenced\",\"details\":"
            + "{\"usage_count\":3,\"visible_count\":2,\"visible_capped\":true,\"referrers\":"
            + "[{\"media_id\":\"m1\",\"project\":\"acme\",\"env\":\"prod\","
            + "\"collection\":\"posts\",\"entry_id\":\"e1\"}]}}}");

    MediaInUseException caught =
        assertThrows(MediaInUseException.class, () -> server.silo("k").health());

    assertEquals(3, caught.usageCount());
    assertEquals(2, caught.visibleCount());
    assertTrue(caught.visibleCapped());
    assertEquals("prod", caught.referrers().get(0).environment());
    assertInstanceOf(ConflictException.class, caught);
  }

  @Test
  void fallsBackOnTheStatusWhenTheBodyIsNotJsonAtAll() {
    server.enqueue(403, "text/html", "<html>proxy denied</html>");

    ForbiddenException caught =
        assertThrows(ForbiddenException.class, () -> server.silo("k").health());
    assertEquals("<html>proxy denied</html>", caught.getMessage());
  }

  @Test
  void keepsAnUnknownCodeAsASiloExceptionRatherThanGuessing() {
    server.enqueue(418, "application/json",
        "{\"error\":{\"code\":\"teapot\",\"message\":\"short and stout\"}}");

    SiloException caught = assertThrows(SiloException.class, () -> server.silo("k").health());
    assertEquals(418, caught.status());
    assertEquals("unknown", caught.code());
  }

  @Test
  void refusesAJsonRouteThatAnsweredSomethingElse() {
    server.enqueue(200, "text/html", "<html>a proxy page</html>");
    assertThrows(InvalidResponseException.class, () -> server.silo("k").health());
  }

  @Test
  void tellsADeadlineFromAHostThatWasNeverThere() {
    server.enqueueFailure(new SocketTimeoutException("read timed out"));
    RequestTimeoutException timedOut = assertThrows(RequestTimeoutException.class,
        () -> server.silo("k").health(RequestOptions.within(Duration.ofMillis(200))));
    assertEquals(Duration.ofMillis(200), timedOut.timeout());

    server.enqueueFailure(new ConnectException("connection refused"));
    NetworkException unreachable =
        assertThrows(NetworkException.class, () -> server.silo("k").health());
    assertTrue(unreachable.getMessage().contains("connection refused"),
        "what the call failed with belongs in the message, not only in the cause");
  }

  @Test
  void tellsACallersOwnCancellationFromADeadline() {
    CancellationSignal signal = CancellationSignal.create();
    signal.cancel();

    assertThrows(RequestAbortedException.class,
        () -> server.silo("k").health(RequestOptions.until(signal)));
    assertEquals(0, server.requestCount(), "a cancelled call is not sent at all");
  }

  @Test
  void doesNotRetryAnythingItself() {
    server.enqueueFailure(new ConnectException("connection refused"));
    assertThrows(NetworkException.class, () -> server.silo("k").health());

    assertEquals(1, server.requestCount(),
        "a retried POST is a duplicate entry, so retry policy is the caller's");
  }

  private Throwable refusal(int status, String code) {
    server.enqueue(status, "application/json",
        "{\"error\":{\"code\":\"" + code + "\",\"message\":\"refused\"}}");
    return assertThrows(SiloException.class, () -> server.silo("k").health());
  }
}
