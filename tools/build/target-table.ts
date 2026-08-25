import type { BuildTarget } from "./build-target";

/** The platforms a release is cut for, and how `host` resolves. */
export class TargetTable {
  private static readonly Targets: Record<string, BuildTarget> = {
    "darwin-arm64": { bunTarget: "bun-darwin-arm64", os: "darwin", arch: "arm64", exe: "", darwin: true },
    "darwin-x64": { bunTarget: "bun-darwin-x64", os: "darwin", arch: "x64", exe: "", darwin: true },
    "linux-x64": { bunTarget: "bun-linux-x64", os: "linux", arch: "x64", exe: "", darwin: false },
    "linux-arm64": { bunTarget: "bun-linux-arm64", os: "linux", arch: "arm64", exe: "", darwin: false },
    "windows-x64": { bunTarget: "bun-windows-x64", os: "windows", arch: "x64", exe: ".exe", darwin: false },
  };

  static get names(): string[] {
    return Object.keys(TargetTable.Targets);
  }

  /** `host` resolves through the running process, so `bun run build` needs no
   *  flags and cannot name a target that disagrees with the machine. */
  static resolve(name: string): BuildTarget {
    if (name !== "host") {
      const target = TargetTable.Targets[name];
      if (!target) {
        throw new Error(`unknown target "${name}" (have: ${TargetTable.names.join(", ")})`);
      }
      return target;
    }

    const os = process.platform === "win32" ? "windows" : process.platform;
    const host = TargetTable.Targets[`${os}-${process.arch}`];
    if (!host) throw new Error(`no target for this host (${process.platform}-${process.arch})`);
    return host;
  }
}
