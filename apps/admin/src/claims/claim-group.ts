/** One line-item of a claim summary: a target, and what the claims permit
 *  there in the reader's words. */
export interface ClaimGroup {
  /** `acme / prod · all collections`, `acme / prod · posts · hooks`, `Media`, … */
  title: string
  /** What the principal may do there, in the reader's words. */
  lines: string[]
  /** Set when the group contains something destructive, escalating, or able to
   *  change a write on its way in. */
  warn?: boolean
}
