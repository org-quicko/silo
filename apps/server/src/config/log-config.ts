/**
 * Where the running server writes its log, and how much of it.
 *
 * `file` deliberately has no default (§10's rule for derived settings): unset
 * means "the console", which is the right answer for a foreground run and for
 * a container, where the supervisor owns the stream. A literal default here
 * would be indistinguishable from a path the user chose and would silently
 * send a `docker run` into a file nobody tails.
 */
export interface LogConfig {
  /** "debug" | "info" | "warn" | "error" | "silent" */
  level: string;
  /** Unset = console. A path appends there, and detached runs derive one. */
  file?: string;
  /** "text" (human) | "json" (one object per line, for a log shipper) */
  format: string;
  /** Whether to log a line per HTTP request. High volume, so it is its own
   *  switch rather than a level: an operator usually wants app logs without
   *  an access log, not one level of both. */
  requests: boolean;
  /** Rotate once the file passes this size. 0 disables rotation. */
  max_size_mb: number;
  /** How many rotated files to keep (`silo.log.1` … `silo.log.<n>`). */
  max_files: number;
}
