/**
 * What a plugin is *doing*, as distinct from what the record says about it
 * (D39, phase 4).
 *
 * The `_plugins` record holds **intent** — granted, enabled — and until phase 4
 * that was the only thing any surface could report, which is why every one of
 * them had to say `restart_required` and hope. A supervisor knows the other
 * half, and the two are genuinely independent: a plugin can be enabled and
 * granted and still not running, because its worker died on a dispatch timeout
 * and `WorkerHost` does not resurrect one (§13.9).
 *
 * Reporting them as one field would have to pick a lie for that case. So this
 * sits beside `enabled` and `state` rather than replacing either.
 */
export interface PluginStatus {
  /**
   * `running` — a worker is up and hooks are being delivered to it.
   * `stopped` — nothing is running, for a reason that is nobody's fault:
   *   disabled, or not listed in `silo.toml` at all.
   * `failed`  — it was running and is not: a crash, or a dispatch that outlived
   *   its budget. `POST /api/plugins/{name}/restart` is the way back.
   */
  state: "running" | "stopped" | "failed";

  /** The hooks it is actually attached to, which is the manifest's list minus
   *  nothing — a declared hook the module does not export refuses the load. */
  hooks: string[];

  /** Why it is not running, in a sentence, or `null` when it is. A state with
   *  no explanation is the thing an operator opens a support ticket about. */
  detail: string | null;
}
