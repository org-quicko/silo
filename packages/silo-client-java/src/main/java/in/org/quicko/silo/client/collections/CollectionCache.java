package in.org.quicko.silo.client.collections;

import com.github.benmanes.caffeine.cache.Caffeine;
import in.org.quicko.silo.client.CacheOptions;
import in.org.quicko.silo.client.entries.EntryReader;
import org.springframework.cache.annotation.AnnotationCacheOperationSource;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.cache.interceptor.CacheProxyFactoryBean;

/** Internal, per-client cache infrastructure. No application context is needed. */
public final class CollectionCache {
  private final SpringCache cache;

  public CollectionCache(CacheOptions options) {
    cache = options == null ? null : new SpringCache(options);
  }

  public EntryReader wrap(EntryReader reader) {
    return cache == null ? reader : cache.wrap(reader);
  }

  public void clear() {
    if (cache != null) cache.clear();
  }

  // Loaded only when caching is enabled, so uncached clients do not require Spring.
  private static final class SpringCache {
    private static final String CACHE_NAME = "silo-collections";
    private final CacheOptions options;
    private final CaffeineCacheManager manager;

    private SpringCache(CacheOptions options) {
      this.options = options;
      manager = new CaffeineCacheManager(CACHE_NAME);
      manager.setAllowNullValues(false);
      clear();
    }

    private EntryReader wrap(EntryReader reader) {
      CacheProxyFactoryBean factory = new CacheProxyFactoryBean();
      factory.setTarget(reader);
      factory.setProxyTargetClass(true);
      factory.setCacheManager(manager);
      factory.setCacheOperationSources(new AnnotationCacheOperationSource());
      factory.afterPropertiesSet();
      factory.afterSingletonsInstantiated();
      return (EntryReader) factory.getObject();
    }

    private void clear() {
      // Pending reads retain the old cache and cannot refill the replacement.
      manager.registerCustomCache(CACHE_NAME, Caffeine.newBuilder()
          .expireAfterWrite(options.ttl())
          .maximumSize(options.maximumSize())
          .build());
    }
  }
}
