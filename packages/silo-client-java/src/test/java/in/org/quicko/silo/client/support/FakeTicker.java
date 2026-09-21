package in.org.quicko.silo.client.support;

import com.github.benmanes.caffeine.cache.Ticker;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A clock the test advances, so a time-to-live can be crossed without sleeping
 * for it. Handed to the cache through {@code CacheOptions.ticker}, which exists
 * for this.
 */
public final class FakeTicker implements Ticker {
  private final AtomicLong nanos = new AtomicLong();

  @Override
  public long read() {
    return nanos.get();
  }

  public void advance(Duration elapsed) {
    nanos.addAndGet(elapsed.toNanos());
  }
}
