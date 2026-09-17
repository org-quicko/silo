package in.org.quicko.silo.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;
import okhttp3.OkHttpClient;

/** Each build creates an independent client cache. Caching is disabled until configured. */
public final class SiloBuilder {
  private String baseUrl;
  private String apiKey;
  private Duration timeout;
  private Map<String, String> headers = Map.of();
  private OkHttpClient httpClient;
  private ObjectMapper objectMapper;
  private CacheOptions cacheOptions;

  SiloBuilder() {}

  SiloBuilder(SiloOptions options, CacheOptions cacheOptions) {
    baseUrl = options.url();
    apiKey = options.key();
    timeout = options.timeout();
    headers = options.headers();
    httpClient = options.httpClient();
    objectMapper = options.objectMapper();
    this.cacheOptions = cacheOptions;
  }

  public SiloBuilder baseUrl(String value) {
    baseUrl = value;
    return this;
  }

  public SiloBuilder apiKey(String value) {
    apiKey = value;
    return this;
  }

  public SiloBuilder timeout(Duration value) {
    timeout = value;
    return this;
  }

  public SiloBuilder headers(Map<String, String> value) {
    headers = value == null ? Map.of() : Map.copyOf(value);
    return this;
  }

  public SiloBuilder httpClient(OkHttpClient value) {
    httpClient = value;
    return this;
  }

  public SiloBuilder objectMapper(ObjectMapper value) {
    objectMapper = value;
    return this;
  }

  /** Enables caching; the configuration must supply a positive TTL. */
  public SiloBuilder cache(Consumer<CacheOptions.Builder> configure) {
    CacheOptions.Builder builder = CacheOptions.builder();
    Objects.requireNonNull(configure, "Cache configuration is required").accept(builder);
    cacheOptions = builder.build();
    return this;
  }

  public SiloBuilder disableCache() {
    cacheOptions = null;
    return this;
  }

  public Silo build() {
    return new Silo(
        new SiloOptions(baseUrl, apiKey, timeout, headers, httpClient, objectMapper), cacheOptions);
  }
}
