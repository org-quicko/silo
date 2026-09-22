export interface SessionInfo {
  label: string
  prefix: string
  claims: string[]
  /** How this instance treats deletes (D91). Absent from a server older than
   *  the trash, which reads as "deletes are permanent". */
  trash?: { enabled: boolean; retention_days: number }
}
