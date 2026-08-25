import type { ValidationDetail } from "@silo/shared/validation-detail";

/** An error flattened for `postMessage`. A class does not survive structured
 *  clone — only its own enumerable data does. */
export interface WireError {
  name: string;
  message: string;
  details?: ValidationDetail[];
}
