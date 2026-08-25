import { parseArgs } from "util";
import fs from "fs/promises";
import path from "path";

/**
 * Packages an already-compiled Linux binary as an RPM, for dnf on Amazon Linux
 * 2023 and anything else in the RHEL family.
 *
 * Separate from `tools/build/` because it is a different job: that one
 * compiles, this one wraps a compiled artifact in metadata, a systemd unit, and
 * install scriptlets. The release workflow runs them in different jobs for the
 * same reason — only this one needs the signing key.
 *
 * The packaging itself is declared in `packaging/rpm/nfpm.yaml`; this script
 * exists to do the three things that config cannot. It stages the binary at the
 * fixed path the config points at (nfpm expands environment variables in scalar
 * fields but not in content globs), maps a silo target name onto nfpm's
 * Go-style architecture name, and turns a missing signing key into an unsigned
 * package rather than an error.
 *
 *   bun run tools/build-rpm.ts --target linux-x64 --version 1.2.3 \
 *     --binary dist/linux-x64/silo [--sign-key private.asc] [--out dist]
 *
 * One glibc note worth keeping here, because it is the reason a single RPM can
 * claim the whole family: the compiled binary needs no symbol newer than
 * GLIBC_2.17 and links no libstdc++. Amazon Linux 2023 ships glibc 2.34.
 */
export class BuildRpm {
  private static readonly config = "packaging/rpm/nfpm.yaml";
  /** Must match the `src` in that config. */
  private static readonly stagedBinary = ".build/rpm/silo";

  /** silo's target names to nfpm's; nfpm writes the RPM spelling itself. */
  private static readonly arches: Record<string, string> = {
    "linux-x64": "amd64",
    "linux-arm64": "arm64",
  };

  static async run(): Promise<void> {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        target: { type: "string" },
        version: { type: "string" },
        binary: { type: "string" },
        "sign-key": { type: "string" },
        out: { type: "string", default: "dist" },
      },
      strict: true,
    });

    for (const flag of ["target", "version", "binary"] as const) {
      if (!values[flag]) throw new Error(`--${flag} is required`);
    }

    const arch = BuildRpm.arches[values.target!];
    if (!arch) {
      throw new Error(`--target must be one of ${Object.keys(BuildRpm.arches).join(", ")}`);
    }

    await BuildRpm.stage(values.binary!);
    await fs.mkdir(values.out!, { recursive: true });

    // An absent key produces an unsigned package; nfpm treats an empty
    // `key_file` as "do not sign" and a path that is not there as an error, so
    // a signing key that was meant to be passed and was mistyped fails the
    // build instead of quietly shipping an unsigned RPM.
    const signKey = values["sign-key"] ? path.resolve(values["sign-key"]) : "";
    if (!signKey) console.warn("warning: no --sign-key, building an unsigned RPM");

    await BuildRpm.exec([BuildRpm.nfpm(), "package", "--config", BuildRpm.config, "--packager", "rpm", "--target", values.out!], {
      SILO_VERSION: values.version!,
      SILO_NFPM_ARCH: arch,
      SILO_RPM_SIGNING_KEY: signKey,
      // nfpm reads the passphrase from the environment; the workflow exports it.
      NFPM_PASSPHRASE: process.env.NFPM_PASSPHRASE ?? "",
    });
  }

  /**
   * Copies the binary to the one path `nfpm.yaml` names, with the mode it must
   * have. `copyFile` preserves the source mode, and an artifact that came back
   * out of a CI upload has usually lost the executable bit, so it is set
   * explicitly rather than inherited.
   */
  private static async stage(binary: string): Promise<void> {
    await fs.mkdir(path.dirname(BuildRpm.stagedBinary), { recursive: true });
    await fs.copyFile(binary, BuildRpm.stagedBinary);
    await fs.chmod(BuildRpm.stagedBinary, 0o755);
  }

  /** `NFPM` overrides the binary, for a CI step that downloaded it somewhere
   *  specific rather than putting it on `PATH`. */
  private static nfpm(): string {
    return process.env.NFPM ?? "nfpm";
  }

  private static async exec(command: string[], env: Record<string, string>): Promise<void> {
    const child = Bun.spawn(command, {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, ...env },
    });
    const status = await child.exited;
    if (status !== 0) {
      if (status === 127 || status === 1) {
        // The overwhelmingly likely cause of a failure here on a laptop.
        console.error("hint: nfpm must be on PATH — https://nfpm.goreleaser.com/");
      }
      throw new Error(`${command[0]} exited with ${status}`);
    }
  }
}

await BuildRpm.run();
