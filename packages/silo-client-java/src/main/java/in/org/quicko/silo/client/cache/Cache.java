package in.org.quicko.silo.client.cache;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a read as cacheable, and optionally states its own ttl and bound.
 *
 * <p>Both numbers win over anything a consumer set in {@link CacheOptions}; a
 * number left out is taken from there instead. Required even when it carries
 * nothing, because it is what makes a read cacheable at all.
 *
 * <p>Why it decorates rather than intercepts: {@code docs/design/java-client.md}
 * §15.8.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Cache {
  /** Seconds a stored response stays servable. */
  long ttl() default Unset;

  /** Responses held before the coldest is evicted. */
  long maxSize() default Unset;

  /** What a number left out reads as — zero, since neither is ever legally that. */
  long Unset = 0;
}
