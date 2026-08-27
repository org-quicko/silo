/** A platform silo can be built for, and the names that follow from it. */
export interface BuildTarget {
  /** What `bun build --compile --target` wants. */
  readonly bunTarget: string;
  /** Goes in artifact names: `silo-1.2.3-<os>-<arch>.tar.gz`. */
  readonly os: string;
  readonly arch: string;
  /** Windows executables need the suffix; nothing else does. */
  readonly exe: string;
  /** Mach-O, and therefore needs a signature to run at all. */
  readonly darwin: boolean;
}
