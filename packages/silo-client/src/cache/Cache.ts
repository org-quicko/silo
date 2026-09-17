import { CachePolicy } from "./CachePolicy.js";

/** Marks a collection read as cacheable. Optional values override the client's settings. */
export function Cache(options: { ttl?: number; maxSize?: number } = {}) {
  return function (
    method: object & { cachePolicy?: CachePolicy },
    _context: ClassMethodDecoratorContext,
  ): void {
    method.cachePolicy = new CachePolicy(options.ttl, options.maxSize);
  };
}
