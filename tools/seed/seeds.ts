/** Derives a stream's seed from the master seed and what the stream is for. */
export class Seeds {
  static of(base: number, key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash ^ base) >>> 0;
  }
}
