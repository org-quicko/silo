import { CommandRunner } from "./command-runner";

/**
 * The ad-hoc Mach-O re-sign, without which a Darwin artifact does not run.
 *
 * `bun build --compile` appends its payload to a copy of the Bun executable,
 * which invalidates the signature the Mach-O arrived with. macOS on arm64 does
 * not warn about that — the kernel refuses to exec an improperly signed binary
 * and the process dies on SIGKILL.
 *
 * `codesign` is macOS-only, so a Darwin target cross-compiled from Linux cannot
 * be signed where it is built. That is a warning rather than an error so the
 * case stays diagnosable; the release workflow builds both Darwin targets on a
 * macOS runner precisely to avoid it.
 */
export class CodeSigner {
  static async signAdHoc(artifact: string): Promise<void> {
    if (process.platform !== "darwin") {
      console.warn(
        `warning: ${artifact} is unsigned — a Darwin build must be signed on macOS to run`
      );
      return;
    }
    // `--force` replaces an existing signature instead of failing on one, so
    // the step stays correct whether or not Bun signed its own output.
    await CommandRunner.run(["codesign", "--sign", "-", "--force", artifact]);
  }
}
