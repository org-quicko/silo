/** The wire's rename preview/result shape, exactly as the server answers it. */
export interface RenamePreviewPayload {
  id: string;
  from: string;
  to: string;
  rewritten_claims: string[];
  pattern_affected_claims: string[];
}

/**
 * What a rename did, or would do. `id` is the record the rename acted
 * on — pass it as `expectedId` to turn a dry run's report into the real call.
 */
export class RenameReport {
  private constructor(
    readonly id: string,
    readonly from: string,
    readonly to: string,
    readonly rewrittenClaims: readonly string[],
    readonly patternAffectedClaims: readonly string[],
  ) {}

  static fromWire(payload: RenamePreviewPayload): RenameReport {
    return new RenameReport(
      payload.id,
      payload.from,
      payload.to,
      payload.rewritten_claims,
      payload.pattern_affected_claims,
    );
  }
}
