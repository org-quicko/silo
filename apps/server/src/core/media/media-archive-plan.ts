/** One file inside an archive part, at its path in the archive. */
export interface MediaArchiveFile {
  id: string;
  path: string;
  size: number;
  modified: Date;
}

/** One `.zip` of a bulk download. `directories` are the empty folders it recreates. */
export interface MediaArchivePart {
  filename: string;
  files: MediaArchiveFile[];
  directories: string[];
  bytes: number;
}

/** A file too large for any part, downloaded from `/media/{id}` instead. */
export interface MediaArchiveSeparateFile {
  id: string;
  filename: string;
  size: number;
}

/** What a selection resolves to, fixed when it is prepared (D106). */
export interface MediaArchivePlan {
  files: number;
  bytes: number;
  parts: MediaArchivePart[];
  separate: MediaArchiveSeparateFile[];
}
