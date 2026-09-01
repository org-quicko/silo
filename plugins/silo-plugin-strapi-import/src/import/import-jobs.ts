import type { ImportJob, ImportProgress } from './import-job'

/**
 * The imports this worker has run, newest first.
 *
 * In memory, and bounded. Persisting them would mean this plugin writing its own
 * bookkeeping into the instance it imports into — a `_strapi_imports` collection
 * an operator did not ask for, in a scope the plan chose — and the thing a job
 * record is *for* is a screen somebody is watching right now.
 *
 * One at a time, and that is a correctness bound rather than a resource one: two
 * concurrent runs of the same plan would both create the collection, both read
 * `total` as zero, and both write every row.
 */
export class ImportJobs {
  /** How many finished runs are kept. Enough to compare a retry with what it
   *  retried; short enough that a busy afternoon does not accumulate. */
  private static readonly Keep = 20

  private readonly jobs: ImportJob[] = []
  private running: ImportJob | null = null

  /** The job in flight, or `null`. */
  current(): ImportJob | null {
    return this.running
  }

  find(id: string): ImportJob | undefined {
    return this.jobs.find((job) => job.id === id)
  }

  list(): ImportProgress[] {
    return this.jobs.map((job) => job.snapshot())
  }

  /**
   * Start `job`, or refuse because one is already running.
   *
   * The promise is deliberately not returned, and not awaited: the caller is a
   * route handler bounded by `timeout_ms`, so awaiting the import here is the
   * timeout this design exists to avoid. `void` rather than a bare call so the
   * float is visible as a decision.
   */
  start(job: ImportJob): void {
    if (this.running) {
      throw new Error(
        `an import is already running (${this.running.id}). Wait for it to finish: two runs ` +
          `of the same plan would each create the collection and each write every row.`,
      )
    }

    this.running = job
    this.jobs.unshift(job)
    this.jobs.length = Math.min(this.jobs.length, ImportJobs.Keep)

    void job
      .run()
      .catch(() => {
        // `ImportJob.run` records its own failure in the progress it hands back,
        // so there is nothing to do here but not become an unhandled rejection —
        // which in a worker is a report about the plugin rather than the import.
      })
      .finally(() => {
        if (this.running === job) this.running = null
      })
  }
}
