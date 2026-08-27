/** An inclusive `min`–`max` pair, parsed from `"5-20"` or a bare `"12"`. */
export interface Range {
  min: number;
  max: number;
}

export interface SeedOptions {
  url: string;
  key: string;
  projects: number;
  envs: string[];
  collections: Range;
  entries: Range;
  seed: number;
  /** Milliseconds the generated dates are measured from. */
  epoch: number;
  concurrency: number;
  dryRun: boolean;
  confirmed: boolean;
}
