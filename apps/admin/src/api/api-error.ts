import { SiloError, type ValidationDetail } from 'silo-client'

export {
  SiloError,
  ValidationFailedError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  MediaInUseError,
  MediaDeleteStalledError,
  InternalError,
  NetworkError,
  TimeoutError,
  RequestAbortedError,
  InvalidResponseError,
} from 'silo-client'
export type { ValidationDetail, ErrorCode } from 'silo-client'

export class ApiError extends SiloError {
  /** Field-level validation failures, when the error carries a list of them. */
  declare details?: ValidationDetail[]
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
    super(status, code, message, '', '')
    this.name = 'ApiError'
    this.details = details
    this.info = info
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}
