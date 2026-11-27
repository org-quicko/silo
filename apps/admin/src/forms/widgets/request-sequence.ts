/**
 * Monotonic request counter so out-of-order async responses from superseded
 * searches, filters, or page changes never overwrite newer results.
 */
export class RequestSequence {
  private current = 0

  next(): number {
    this.current += 1
    return this.current
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.current
  }

  invalidate(): void {
    this.current += 1
  }
}
