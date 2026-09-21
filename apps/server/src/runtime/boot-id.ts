import fs from "fs";

/**
 * The kernel's id for this boot, where the platform offers one (D82).
 *
 * Linux writes a fresh UUID to `/proc/sys/kernel/random/boot_id` at every
 * start. A run record carrying a different one was written before a reboot,
 * whatever its pid now points at — which is exactly the case a pid check gets
 * wrong, since a low pid is reused by an early service on the next boot.
 * Undefined elsewhere, and the record then rests on the other tests.
 */
export class BootId {
  private static readonly Path = "/proc/sys/kernel/random/boot_id";
  private static cached: string | undefined | null = null;

  static current(): string | undefined {
    if (BootId.cached !== null) return BootId.cached;
    try {
      BootId.cached = fs.readFileSync(BootId.Path, "utf8").trim() || undefined;
    } catch {
      BootId.cached = undefined;
    }
    return BootId.cached;
  }
}
