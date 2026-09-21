import type { ExportManifest } from "./export-manifest";
import type { ImportedProject, ScopedImport } from "./import-walker";

/** An archive read off disk, before anything has been written from it. */
export interface ParsedImport {
  manifest: ExportManifest;
  scopes: ScopedImport[];
  /** Projects the archive names, so one holding no environment survives the
   *  round trip (D51). Absent when the caller built the unit in memory. */
  projects?: ImportedProject[];
}
