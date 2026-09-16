package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.org.quicko.silo.client.CancellationSignal;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.errors.ErrorFactory;
import in.org.quicko.silo.client.errors.NetworkException;
import in.org.quicko.silo.client.errors.RequestAbortedException;
import in.org.quicko.silo.client.errors.RequestTimeoutException;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.Map;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * The one place a request is made. Sends {@code Authorization: Bearer <key>}
 * when a key is set and nothing when it is not, since anonymous reads are legal.
 *
 * <p>Three failures are told apart rather than collapsed: a cancellation raises
 * {@link RequestAbortedException}, a deadline raises
 * {@link RequestTimeoutException}, and a request that never landed raises
 * {@link NetworkException}. Nothing here retries, because a retried POST is a
 * duplicate entry and a retried 409 is wrong by definition.
 */
public final class Transport {
  private static final MediaType JsonMediaType = MediaType.get("application/json; charset=utf-8");

  private final TransportOptions options;
  private final String url;
  private final OkHttpClient http;
  private final JsonCodec codec;

  public Transport(TransportOptions options) {
    this.options = options;
    this.url = normalizeUrl(options.url());
    this.http = options.httpClient() == null ? new OkHttpClient() : options.httpClient();
    ObjectMapper mapper =
        options.objectMapper() == null ? JsonCodec.defaultMapper() : options.objectMapper();
    this.codec = new JsonCodec(mapper);
  }

  public JsonCodec codec() {
    return codec;
  }

  /** A route documented to answer JSON. A body of any other type is refused. */
  public JsonNode json(TransportRequest request) {
    RawResponse response = execute(request, null);
    return ResponseDecoder.decode(
        response.status(), response.contentType(), response.body(), request, codec, true);
  }

  public <T> T json(TransportRequest request, Class<T> type) {
    return codec.convert(json(request), type);
  }

  public <T> T json(TransportRequest request, TypeReference<T> type) {
    return codec.convert(json(request), type);
  }

  public <T> T json(TransportRequest request, JavaType type) {
    return codec.convert(json(request), type);
  }

  /** For a route that answers 204: sends it, and discards the result. */
  public void empty(TransportRequest request) {
    RawResponse response = execute(request, null);
    ResponseDecoder.decode(
        response.status(), response.contentType(), response.body(), request, codec, false);
  }

  /** Multipart upload. The body carries its own content type, boundary included. */
  public JsonNode upload(TransportRequest request, RequestBody form) {
    RawResponse response = execute(request, form);
    return ResponseDecoder.decode(
        response.status(), response.contentType(), response.body(), request, codec, true);
  }

  /** A new transport reading a different key, sharing everything else. */
  public Transport withKey(String key) {
    return new Transport(options.withKey(key));
  }

  /** A new transport reading a different base URL, sharing everything else. */
  public Transport withUrl(String target) {
    return new Transport(options.withUrl(target));
  }

  private RawResponse execute(TransportRequest request, RequestBody multipart) {
    RequestOptions callOptions = request.options();
    if (callOptions.isCancelled()) {
      throw new RequestAbortedException(request.method(), request.path());
    }

    Duration deadline = callOptions.timeout() != null ? callOptions.timeout() : options.timeout();
    OkHttpClient client = deadline == null ? http : http.newBuilder().callTimeout(deadline).build();
    Call call = client.newCall(buildRequest(request, multipart));
    CancellationSignal signal = callOptions.cancellation();

    try (CancellationSignal.Registration registration =
            signal == null ? () -> { } : signal.onCancel(call::cancel);
        Response response = call.execute()) {
      ResponseBody body = response.body();
      String raw = body == null ? "" : body.string();
      if (!response.isSuccessful()) {
        throw ErrorFactory.fromResponseBody(
            response.code(), request.method(), request.path(), raw, codec);
      }
      return new RawResponse(response.code(), response.header("content-type"), raw);
    } catch (IOException caught) {
      throw transportFailure(request, signal, deadline, client, caught);
    }
  }

  /**
   * Why the call itself failed. Cancellation is checked first because OkHttp
   * reports a cancelled call as an ordinary {@link IOException}, indistinguishable
   * by type from a host that was never reachable.
   */
  private RuntimeException transportFailure(
      TransportRequest request,
      CancellationSignal signal,
      Duration deadline,
      OkHttpClient client,
      IOException caught) {
    if (signal != null && signal.isCancelled()) {
      return new RequestAbortedException(request.method(), request.path());
    }
    if (isTimeout(caught)) {
      Duration reported =
          deadline != null ? deadline : Duration.ofMillis(client.readTimeoutMillis());
      return new RequestTimeoutException(request.method(), request.path(), reported);
    }
    return new NetworkException(request.method(), request.path(), caught);
  }

  private static boolean isTimeout(IOException caught) {
    if (caught instanceof SocketTimeoutException) return true;
    return caught instanceof InterruptedIOException && "timeout".equals(caught.getMessage());
  }

  private Request buildRequest(TransportRequest request, RequestBody multipart) {
    Request.Builder builder =
        new Request.Builder().url(url + request.path() + QueryString.build(request.query()));

    for (Map.Entry<String, String> header : options.headers().entrySet()) {
      builder.header(header.getKey(), header.getValue());
    }
    for (Map.Entry<String, String> header : request.headers().entrySet()) {
      builder.header(header.getKey(), header.getValue());
    }
    if (options.key() != null && !options.key().isEmpty()) {
      builder.header("Authorization", "Bearer " + options.key());
    }

    return builder.method(request.method(), bodyFor(request, multipart)).build();
  }

  /**
   * OkHttp refuses a body on GET and demands one on POST, PUT and PATCH, so a
   * bodyless write is sent as an empty body rather than as the null OkHttp rejects.
   */
  private RequestBody bodyFor(TransportRequest request, RequestBody multipart) {
    if (multipart != null) return multipart;

    if (request.body() != null) {
      String declared = request.headers().get("Content-Type");
      MediaType type = declared == null ? JsonMediaType : MediaType.get(declared);
      return RequestBody.create(codec.write(request.body()), type);
    }

    String method = request.method();
    boolean requiresBody = method.equals("POST") || method.equals("PUT") || method.equals("PATCH");
    return requiresBody ? RequestBody.create(new byte[0], null) : null;
  }

  private static String normalizeUrl(String target) {
    return target.replaceAll("/+$", "");
  }

  /** What a caller of execute needs, with the OkHttp response already closed. */
  private record RawResponse(int status, String contentType, String body) { }
}
