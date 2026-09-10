/** What `GET /api/health` answers — never authenticated. */
export interface HealthReport {
  readonly status: string;
  readonly version: string;
}
