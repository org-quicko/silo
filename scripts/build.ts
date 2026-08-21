/**
 * Compiles the server into a standalone `silo` binary.
 *
 * This is a script rather than a `package.json` one-liner because the last step
 * is platform-conditional. `bun build --compile` appends its payload to a copy
 * of the Bun executable, which invalidates the code signature the Mach-O
 * arrived with; macOS then refuses to run the result, so the binary has to be
 * re-signed ad hoc. No other platform has anything to do here — Windows and
 * Linux run the compiled file as-is — and `codesign` does not exist off macOS,
 * which is what made the old inline `&& codesign -s - silo` fail there.
 */
export class BuildBinary {
  private static readonly entrypoint = "./server/main.ts"
  private static readonly outfile = "silo"

  /** Where `--compile` actually writes: Bun appends `.exe` on Windows itself. */
  static artifact(): string {
    return process.platform === "win32" ? `${BuildBinary.outfile}.exe` : BuildBinary.outfile
  }

  static async run(): Promise<void> {
    // `process.execPath` is the Bun running this script, so the compile cannot
    // pick up a different Bun than the one invoked through `bun run build`.
    await BuildBinary.exec([
      process.execPath,
      "build",
      BuildBinary.entrypoint,
      "--compile",
      "--outfile",
      BuildBinary.outfile,
    ])

    const artifact = BuildBinary.artifact()
    if (process.platform === "darwin") await BuildBinary.signAdHoc(artifact)

    const size = (await Bun.file(artifact).stat()).size
    console.log(`${artifact}  ${(size / 1024 / 1024).toFixed(1)} MB`)
  }

  /**
   * `--force` replaces any signature already on the file instead of failing on
   * one, so the step stays idempotent across Bun versions: whether or not Bun
   * has signed the output itself, a rebuild ends up ad-hoc signed either way.
   */
  private static async signAdHoc(artifact: string): Promise<void> {
    await BuildBinary.exec(["codesign", "--sign", "-", "--force", artifact])
  }

  private static async exec(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
    const status = await child.exited
    if (status !== 0) {
      throw new Error(`${command[0]} exited with ${status}`)
    }
  }
}

await BuildBinary.run()
