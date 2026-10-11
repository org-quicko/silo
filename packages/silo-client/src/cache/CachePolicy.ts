/** Method-level cache settings. An absent value inherits the client's setting. */
export class CachePolicy {
  constructor(
    readonly ttl?: number,
    readonly maxSize?: number,
  ) {}

  static declaredOn(method: object & { cachePolicy?: CachePolicy }): CachePolicy {
    if (!(method.cachePolicy instanceof CachePolicy)) {
      throw new TypeError("The method must declare @Cache()");
    }
    return method.cachePolicy;
  }
}
