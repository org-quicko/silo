package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.ObjectMapper;
import in.org.quicko.silo.client.cache.CacheOptions;
import java.time.Duration;
import java.util.Map;
import okhttp3.OkHttpClient;

/**
 * What {@link Transport} needs to construct. Built by {@code Silo} from
 * {@code SiloOptions}, and not part of the client's public surface.
 */
public record TransportOptions(
    String url,
    String key,
    Map<String, String> headers,
    Duration timeout,
    OkHttpClient httpClient,
    ObjectMapper objectMapper,
    CacheOptions cache) {

  public TransportOptions withKey(String value) {
    return new TransportOptions(url, value, headers, timeout, httpClient, objectMapper, cache);
  }

  public TransportOptions withUrl(String value) {
    return new TransportOptions(value, key, headers, timeout, httpClient, objectMapper, cache);
  }
}
