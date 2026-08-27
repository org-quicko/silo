import { Rng } from "./rng";

/**
 * Dates, measured from an explicit epoch rather than `Date.now()`. Reading the
 * clock inside generation was the one thing that made two runs of the same seed
 * differ — everything else was already reproducible, and the difference was
 * invisible until two corpora were compared field by field.
 */
export class Calendar {
  constructor(private readonly rng: Rng, private readonly epoch: number) {}

  /** An ISO instant somewhere in the `daysBack` days before the epoch. */
  past(daysBack = 730): string {
    return new Date(this.epoch - this.rng.int(0, daysBack) * 86_400_000 - this.rng.int(0, 86_399_000)).toISOString();
  }

  /** An ISO instant somewhere in the `daysAhead` days after it. */
  future(daysAhead = 180): string {
    return new Date(this.epoch + this.rng.int(0, daysAhead) * 86_400_000 + this.rng.int(0, 86_399_000)).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
