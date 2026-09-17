package in.org.quicko.silo.client;

import java.time.Duration;

/** Expiration after insertion and an entry-count limit, shared by one client's collection reads. */
public record CacheOptions(Duration ttl, long maximumSize) {
  public CacheOptions {
    if (ttl == null || ttl.isZero() || ttl.isNegative()) {
      throw new IllegalArgumentException("Cache TTL must be a positive duration");
    }
    if (maximumSize <= 0) {
      throw new IllegalArgumentException("Cache maximum size must be positive");
    }
  }

  public static Builder builder() {
    return new Builder();
  }

  public static final class Builder {
    private Duration ttl;
    private long maximumSize = 1_000;

    public Builder ttl(Duration value) {
      ttl = value;
      return this;
    }

    /** Limits the number of cached responses, not their combined byte size. */
    public Builder maximumSize(long value) {
      maximumSize = value;
      return this;
    }

    public CacheOptions build() {
      return new CacheOptions(ttl, maximumSize);
    }
  }
}
