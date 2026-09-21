package in.org.quicko.silo.client.cache;

import com.github.benmanes.caffeine.cache.Ticker;
import java.time.Duration;

/**
 * Whether reads are cached, and the ttl and bound they use where their own
 * {@link Cache} states none. What the annotation states wins over these.
 *
 * <p>Off unless asked for: a cached read hands back the {@code rev} it was
 * stored with, and a write carrying a stale one raises a conflict the caller
 * did nothing to cause.
 */
public record CacheOptions(boolean enabled, Duration ttl, Long maxSize, Ticker ticker) {

  private static final CacheOptions Off = new CacheOptions(false, null, null, null);
  private static final CacheOptions On = new CacheOptions(true, null, null, null);

  /** Caching off. Named for the reason {@code RequestOptions.within} is: a
   *  static and a record accessor cannot share one signature. */
  public static CacheOptions off() {
    return Off;
  }

  /** Caching on, every read at the numbers its own {@link Cache} states. */
  public static CacheOptions on() {
    return On;
  }

  /** Caching on, at these numbers wherever a read states none of its own. */
  public static CacheOptions on(Duration ttl, long maxSize) {
    return new CacheOptions(true, ttl, maxSize, null);
  }

  public CacheOptions ttl(Duration value) {
    return new CacheOptions(enabled, value, maxSize, ticker);
  }

  public CacheOptions maxSize(long value) {
    return new CacheOptions(enabled, ttl, value, ticker);
  }

  /** Caching on against a clock the caller advances, so a ttl can be tested
   *  without sleeping for one. */
  public CacheOptions ticker(Ticker value) {
    return new CacheOptions(enabled, ttl, maxSize, value);
  }

  /**
   * What governs a read: what it stated, then these underneath. Null when
   * nothing is held at all, and raises when neither side named a number.
   */
  public CachePolicy inForce(CachePolicy declared) {
    if (!enabled) return null;

    Duration chosenTtl = declared.ttl() != null ? declared.ttl() : ttl;
    Long chosenMaxSize = declared.maxSize() != null ? declared.maxSize() : maxSize;
    if (chosenTtl == null) throw missing("ttl");
    if (chosenMaxSize == null) throw missing("maxSize");

    return new CachePolicy(chosenTtl, chosenMaxSize);
  }

  private static IllegalStateException missing(String number) {
    return new IllegalStateException(
        "no " + number + " for a cached read: state one on its @Cache, or on CacheOptions");
  }
}
