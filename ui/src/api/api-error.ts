import type { ValidationDetail } from '@silo/shared/validation-detail'

export class ApiError extends Error {
  status: number
  code: string
  details?: ValidationDetail[]
  constructor(status: number, code: string, message: string, details?: ValidationDetail[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}
