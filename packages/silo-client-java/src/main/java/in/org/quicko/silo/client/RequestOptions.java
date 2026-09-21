package in.org.quicko.silo.client;

import java.time.Duration;

/**
 * The one cancellation convention on every call: the last parameter of every
 * method in the client, and overloaded away where a caller wants neither.
 *
 * <p>A per-call {@code timeout} wins over the client's own default. Both
 * components may be null, which is what {@link #none()} is.
 */
public record RequestOptions(Duration timeout, CancellationSignal cancellation) {
  private static final RequestOptions NONE = new RequestOptions(null, null);

  public static RequestOptions none() {
    return NONE;
  }

  /** A deadline for one call. Named {@code within} rather than {@code timeout}
   *  because a static and an instance method cannot share one signature. */
  public static RequestOptions within(Duration timeout) {
    return new RequestOptions(timeout, null);
  }

  /** Options carrying nothing but a signal the caller can cancel. */
  public static RequestOptions until(CancellationSignal cancellation) {
    return new RequestOptions(null, cancellation);
  }

  public RequestOptions timeout(Duration value) {
    return new RequestOptions(value, cancellation);
  }

  public RequestOptions cancelledBy(CancellationSignal value) {
    return new RequestOptions(timeout, value);
  }

  /** Whether the caller has already cancelled, checked before a request is
   *  sent at all so a cancelled batch stops rather than issuing one more call. */
  public boolean isCancelled() {
    return cancellation != null && cancellation.isCancelled();
  }
}
