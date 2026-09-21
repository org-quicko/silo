import type { ImportResult } from "./import-result";

/** Which part of an import is running. */
export type ImportPhase = "extract" | "entries" | "media";

/**
 * A running import's state, reported often enough that a caller watching one
 * never waits long for a sign of life.
 *
 * The counts are the live `ImportResult` — the same object the final answer is
 * built from, so a progress line and the result cannot describe different runs.
 */
export interface ImportProgress {
  phase: ImportPhase;
  result: ImportResult;
}

export type ImportProgressReporter = (progress: ImportProgress) => void;
