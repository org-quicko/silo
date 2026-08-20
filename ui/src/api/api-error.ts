import type { ValidationDetail } from '@silo/shared/validation-detail'

export class ApiError extends Error {
  status: number
  code: string
  /** Field-level validation failures, when the error carries a list of them. */
  details?: ValidationDetail[]
  /**
   * A structured error payload that is not a validation list — a refused
   * media delete carries its usage count and referrers here (D23). Kept
   * separate from `details` so neither shape has to be narrowed at every read
   * site.
   */
  info?: Record<string, unknown>
  constructor(
    status: number,
    code: string,
    message: string,
    details?: ValidationDetail[],
    info?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.info = info
  }
}
