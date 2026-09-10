/**
 * One field-level validation failure: a JSON Pointer path plus the message
 * the validator raised, exactly as the wire's `error.details` carries it.
 */
export interface ValidationDetail {
  path: string;
  message: string;
}
