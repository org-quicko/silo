package in.org.quicko.silo.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.org.quicko.silo.client.cache.CacheOptions;
import java.time.Duration;
import java.util.Map;
import okhttp3.OkHttpClient;

/**
 * Everything {@code new Silo(...)} accepts. Only the URL is required: a key is
 * optional because anonymous reads are legal.
 *
 * <p>{@code httpClient} is where a caller hands over their own OkHttp — an
 * interceptor, a proxy, a connection pool they already tune. {@code objectMapper}
 * is where they register the Jackson modules their own field types need.
 * {@code cache} turns the response cache on, and is off until it is asked for.
 * All three default to a plain instance the client owns.
 */
public record SiloOptions(
    String url,
    String key,
    Duration timeout,
    Map<String, String> headers,
    OkHttpClient httpClient,
    ObjectMapper objectMapper,
    CacheOptions cache) {

  public SiloOptions {
    if (url == null || url.isBlank()) {
      throw new IllegalArgumentException("SiloOptions needs the URL of a silo instance");
    }
    headers = headers == null ? Map.of() : Map.copyOf(headers);
    cache = cache == null ? CacheOptions.off() : cache;
  }

  /** An anonymous client: reads whatever the instance serves without a key. */
  public static SiloOptions of(String url) {
    return new SiloOptions(url, null, null, Map.of(), null, null, null);
  }

  public static SiloOptions of(String url, String key) {
    return new SiloOptions(url, key, null, Map.of(), null, null, null);
  }

  public SiloOptions url(String value) {
    return new SiloOptions(value, key, timeout, headers, httpClient, objectMapper, cache);
  }

  public SiloOptions key(String value) {
    return new SiloOptions(url, value, timeout, headers, httpClient, objectMapper, cache);
  }

  /** The default deadline for every call, which a per-call one overrides. */
  public SiloOptions timeout(Duration value) {
    return new SiloOptions(url, key, value, headers, httpClient, objectMapper, cache);
  }

  public SiloOptions headers(Map<String, String> value) {
    return new SiloOptions(url, key, timeout, value, httpClient, objectMapper, cache);
  }

  public SiloOptions httpClient(OkHttpClient value) {
    return new SiloOptions(url, key, timeout, headers, value, objectMapper, cache);
  }

  public SiloOptions objectMapper(ObjectMapper value) {
    return new SiloOptions(url, key, timeout, headers, httpClient, value, cache);
  }

  /** Turns the response cache on for the reads that declare a policy. */
  public SiloOptions cache(CacheOptions value) {
    return new SiloOptions(url, key, timeout, headers, httpClient, objectMapper, value);
  }
}
