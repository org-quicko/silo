package in.org.quicko.silo.client;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The client's answer to {@code AbortSignal}: one object a caller cancels, which
 * every in-flight request holding it stops on. Share one across a batch of calls
 * to cancel them together, or give a long paging loop its own.
 *
 * <p>Cancelling is one-way and idempotent. A request cancelled this way raises
 * {@link in.org.quicko.silo.client.errors.RequestAbortedException}, which is how
 * a caller tells "I stopped this" from a deadline the client imposed.
 */
public final class CancellationSignal {
  private final AtomicBoolean cancelled = new AtomicBoolean(false);
  private final Set<Runnable> listeners = ConcurrentHashMap.newKeySet();

  public static CancellationSignal create() {
    return new CancellationSignal();
  }

  public boolean isCancelled() {
    return cancelled.get();
  }

  /** Cancels every request currently holding this signal, and every later one. */
  public void cancel() {
    if (!cancelled.compareAndSet(false, true)) return;
    for (Runnable listener : listeners) {
      listener.run();
    }
    listeners.clear();
  }

  /**
   * Runs {@code action} when this signal is cancelled, or immediately when it
   * already has been. Close the registration once the request settles, whichever
   * way, so a finished call does not outlive itself as a listener.
   */
  public Registration onCancel(Runnable action) {
    if (cancelled.get()) {
      action.run();
      return () -> {};
    }
    listeners.add(action);
    // Closes the window where cancel() ran between the check above and the add.
    // It can run the action twice in that race, which is why an action must be
    // idempotent; cancelling an OkHttp call already is.
    if (cancelled.get()) {
      listeners.remove(action);
      action.run();
    }
    return () -> listeners.remove(action);
  }

  /** Undoes one {@link #onCancel} registration. */
  @FunctionalInterface
  public interface Registration extends AutoCloseable {
    @Override
    void close();
  }
}
