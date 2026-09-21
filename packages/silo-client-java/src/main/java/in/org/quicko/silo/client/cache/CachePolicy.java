package in.org.quicko.silo.client.cache;

import in.org.quicko.silo.client.transport.TransportRequest;
import java.lang.invoke.MethodType;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * How long a read holds a response and how many it holds. A null component is
 * one the read left to {@link CacheOptions}; {@link CacheOptions#inForce} is
 * the only thing that answers a complete one.
 *
 * <p>Also what a Caffeine instance is built and looked up by, since the two
 * numbers are the only reason a read needs one of its own.
 */
public record CachePolicy(Duration ttl, Long maxSize) {

  private static final StackWalker Walker =
      StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE);

  /** Frames between a read and this call. Dropped by class rather than by a
   *  count, so moving the call cannot silently shift which frame is read. */
  private static final Set<Class<?>> Plumbing =
      Set.of(CachePolicy.class, TransportRequest.Builder.class);

  private static final Map<String, CachePolicy> Declared = new ConcurrentHashMap<>();

  public CachePolicy {
    if (ttl != null && (ttl.isNegative() || ttl.isZero())) {
      throw new IllegalArgumentException("a cache ttl has to be positive");
    }
    if (maxSize != null && maxSize <= 0) {
      throw new IllegalArgumentException("a cache maxSize has to be positive");
    }
  }

  /**
   * What the calling method's {@link Cache} declares, read once and remembered.
   * Raises when that method declares none.
   *
   * <p>Only the immediate caller is consulted, so a read that delegated its
   * request-building fails here rather than inheriting numbers from further up
   * the stack.
   */
  public static CachePolicy declaredOnCaller() {
    return Walker.walk(frames -> frames
        .dropWhile(frame -> Plumbing.contains(frame.getDeclaringClass()))
        .findFirst()
        .map(CachePolicy::declaredOn)
        .orElseThrow(() -> new IllegalStateException("cache() was called by nothing")));
  }

  private static CachePolicy declaredOn(StackWalker.StackFrame frame) {
    String remembered =
        frame.getDeclaringClass().getName() + "#" + frame.getMethodName() + frame.getDescriptor();
    return Declared.computeIfAbsent(remembered, ignored -> read(frame));
  }

  /** Matches on the signature, not the name alone, so one annotated overload
   *  cannot answer for another that declared nothing. */
  private static CachePolicy read(StackWalker.StackFrame frame) {
    Class<?> owner = frame.getDeclaringClass();
    for (Method candidate : owner.getDeclaredMethods()) {
      if (!candidate.getName().equals(frame.getMethodName())) continue;
      MethodType signature =
          MethodType.methodType(candidate.getReturnType(), candidate.getParameterTypes());
      if (!signature.equals(frame.getMethodType())) continue;

      Cache declared = candidate.getAnnotation(Cache.class);
      if (declared == null) break;
      return new CachePolicy(
          declared.ttl() == Cache.Unset ? null : Duration.ofSeconds(declared.ttl()),
          declared.maxSize() == Cache.Unset ? null : declared.maxSize());
    }
    throw new IllegalStateException(
        "no @Cache on " + owner.getName() + "." + frame.getMethodName()
            + ": cache() has to be called by the read that declares it");
  }
}
