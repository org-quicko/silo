package in.org.quicko.silo.client.support;

import in.org.quicko.silo.client.Silo;
import in.org.quicko.silo.client.SiloOptions;
import in.org.quicko.silo.client.cache.CacheOptions;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Queue;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

/**
 * The test double the whole suite runs on: an OkHttp application interceptor
 * that records each request and answers the next queued response without ever
 * opening a socket.
 *
 * <p>An interceptor rather than a local server, for the reason the TypeScript
 * package uses a stub fetch: a test should assert on the request the client
 * built, and binding a port to learn that adds a way for the suite to fail that
 * has nothing to do with the client.
 */
public final class StubHttp implements Interceptor {
  /** Never resolved: the interceptor answers before anything would connect. */
  public static final String BaseUrl = "http://silo.test";

  private final Queue<Canned> responses = new ArrayDeque<>();
  private final List<RecordedRequest> requests = new ArrayList<>();

  public static StubHttp create() {
    return new StubHttp();
  }

  /** A client pointed at this stub, with a key. */
  public Silo silo(String key) {
    return new Silo(SiloOptions.of(BaseUrl, key).httpClient(client()));
  }

  /** A client pointed at this stub whose reads are cached, for the cache suite. */
  public Silo caching(CacheOptions cache) {
    return new Silo(SiloOptions.of(BaseUrl, "k").httpClient(client()).cache(cache));
  }

  /** A client pointed at this stub with no key, for the anonymous reads. */
  public Silo anonymous() {
    return new Silo(SiloOptions.of(BaseUrl).httpClient(client()));
  }

  public OkHttpClient client() {
    return new OkHttpClient.Builder().addInterceptor(this).build();
  }

  public StubHttp enqueue(int status, String contentType, String body) {
    responses.add(new Canned(status, contentType, body, null));
    return this;
  }

  public StubHttp enqueueJson(String body) {
    return enqueue(200, "application/json", body);
  }

  public StubHttp enqueueNoContent() {
    return enqueue(204, null, null);
  }

  /** The call fails the way the runtime would fail it, so the mapping from an
   *  {@link IOException} to the client's own three failures can be exercised. */
  public StubHttp enqueueFailure(IOException failure) {
    responses.add(new Canned(0, null, null, failure));
    return this;
  }

  public RecordedRequest request(int index) {
    if (index < 0 || index >= requests.size()) {
      throw new NoSuchElementException("the stub saw only " + requests.size() + " requests");
    }
    return requests.get(index);
  }

  public RecordedRequest lastRequest() {
    return request(requests.size() - 1);
  }

  public int requestCount() {
    return requests.size();
  }

  @Override
  public Response intercept(Chain chain) throws IOException {
    Request request = chain.request();
    requests.add(record(request));

    Canned canned = responses.isEmpty()
        ? new Canned(500, "application/json",
            "{\"error\":{\"code\":\"internal\",\"message\":\"no response was queued\"}}", null)
        : responses.remove();

    if (canned.failure() != null) throw canned.failure();

    String contentType = canned.contentType();
    ResponseBody body = ResponseBody.create(
        canned.body() == null ? "" : canned.body(),
        contentType == null ? null : MediaType.get(contentType));

    Response.Builder response = new Response.Builder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .code(canned.status())
        .message("stubbed")
        .body(body);
    if (contentType != null) response.header("Content-Type", contentType);
    return response.build();
  }

  private static RecordedRequest record(Request request) {
    Map<String, String> headers = new HashMap<>();
    request.headers().forEach(header -> headers.put(header.getFirst().toLowerCase(), header.getSecond()));

    return new RecordedRequest(
        request.method(),
        request.url().encodedPath(),
        request.url().encodedQuery(),
        request.body() == null || request.body().contentType() == null
            ? null
            : request.body().contentType().toString(),
        Map.copyOf(headers),
        bodyOf(request));
  }

  /** OkHttp sets the Content-Type header itself, after every application
   *  interceptor, so it is read off the body rather than off the headers. */
  private static String bodyOf(Request request) {
    if (request.body() == null) return "";
    try (Buffer buffer = new Buffer()) {
      request.body().writeTo(buffer);
      return buffer.readUtf8();
    } catch (IOException caught) {
      throw new UncheckedIOException("could not read the request body back", caught);
    }
  }

  private record Canned(int status, String contentType, String body, IOException failure) {}
}
