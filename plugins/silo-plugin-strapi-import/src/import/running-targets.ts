import type { ImportPlan } from './import-plan'

/**
 * Which collections the imports in flight are writing, across every session.
 *
 * What is left of "one import at a time" once a session is per operator. Two
 * people importing different collections is ordinary and now runs in parallel;
 * two writing the *same* one would each create it, each read the existing count
 * as zero, and each write every row — so that pair is refused by name rather
 * than merged. It is the whole of this plugin's conflict handling, deliberately.
 */
export class RunningTargets {
  /** How many imports may run at once. They all queue on silo's write lock, so
   *  more than a few makes every one of them slower and none of them sooner. */
  static readonly MaxRunning = 3

  /** `project/env/collection` to the job writing it. */
  private readonly held = new Map<string, string>()
  private readonly byJob = new Map<string, string[]>()

  /** Claim every collection `plan` writes, and answer the release for them. */
  claim(jobId: string, plan: ImportPlan): () => void {
    if (this.byJob.size >= RunningTargets.MaxRunning) {
      throw new Error(
        `${RunningTargets.MaxRunning} imports are already running. Wait for one to finish: ` +
          `they all queue on silo's write lock, so a fourth would not start sooner.`,
      )
    }

    const targets = plan.steps.map(
      (step) => `${plan.project}/${plan.env}/${step.collection}`,
    )
    for (const target of targets) {
      const holder = this.held.get(target)
      if (holder) {
        throw new Error(
          `"${target}" is being written by import ${holder} right now. Wait for it to finish, ` +
            `or import into a collection of another name.`,
        )
      }
    }

    for (const target of targets) this.held.set(target, jobId)
    this.byJob.set(jobId, targets)
    return () => this.release(jobId)
  }

  /** Give up whatever `jobId` held. Releasing twice is a success. */
  release(jobId: string): void {
    for (const target of this.byJob.get(jobId) ?? []) {
      if (this.held.get(target) === jobId) this.held.delete(target)
    }
    this.byJob.delete(jobId)
  }
}
