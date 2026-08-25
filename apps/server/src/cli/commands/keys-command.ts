import { SiloService } from "../../core/services/silo-service";
import { KeyService } from "../../core/services/key-service";
import { Claims } from "@silo/shared/claims";
import { KeyUtils } from "../../core/keys/key-utils";
import { AuditUtils } from "../../core/audit/audit-utils";

export class KeysCommand {
  static async run(
    service: SiloService,
    store: any,
    positionals: string[],
    values: any
  ): Promise<void> {
    const sub = positionals[1];
    if (!sub) {
      console.error("usage: silo keys <create|list|revoke> [flags]");
      process.exit(1);
    }

    if (sub === "create") {
      const project = typeof values.project === "string" && values.project.trim() ? values.project.trim() : "*";
      const env = typeof values.env === "string" && values.env.trim() ? values.env.trim() : "*";
      const collectionsStr = typeof values.collections === "string" ? values.collections : "";
      const colls = collectionsStr
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean);
      const targets = colls.length > 0
        ? colls.map((c: string) => (c.includes("/") ? c : `${project}/${env}/${c}`))
        : [`${project}/${env}/*`];

      const claimsStr = typeof values.claims === "string" ? values.claims : "";
      const claims = claimsStr
        ? Claims.normalize(claimsStr.split(",").map((claim: string) => claim.trim()).filter(Boolean))
        : Claims.fromPreset(
            KeyUtils.parsePreset(typeof values.preset === "string" ? values.preset : "read"),
            targets
          );

      const labelStr = typeof values.label === "string" ? values.label : "";
      // Recorded as the CLI, not as `system`: the offline path is bounded by
      // filesystem access rather than by a key, and a trail that could not tell
      // the two apart would be missing the more interesting half (D38).
      const { secret, entry } = await service.keys.create(labelStr, claims, {
        actor: AuditUtils.cli(),
      });
      console.log(
        `created key ${entry.id} (${claims.length} claim${claims.length === 1 ? "" : "s"})\n\n  ${secret}\n\nShown only this once.`
      );
    } else if (sub === "list") {
      const keys = await service.keys.list();
      console.log(
        "ID".padEnd(28) +
          "LABEL".padEnd(20) +
          "CLAIMS".padEnd(48) +
          "PREFIX".padEnd(15) +
          "CREATED"
      );
      for (const e of keys) {
        const v = KeyService.toView(e);
        const claims = v.claims.join(",");
        console.log(
          v.id.padEnd(28) +
            v.label.padEnd(20) +
            claims.padEnd(48) +
            v.prefix.padEnd(15) +
            v.created_at
        );
      }
    } else if (sub === "revoke") {
      const id = positionals[2];
      if (!id) {
        console.error("usage: silo keys revoke <id>");
        process.exit(1);
      }
      const removed = await service.keys.revoke(id, AuditUtils.cli());
      // Descendants go too (D38), and saying so here is the only place an
      // operator finds out before looking at the trail.
      if (removed.length > 1) {
        console.log(`also revoked ${removed.length - 1} key(s) minted by it:`);
        for (const child of removed.slice(0, -1)) console.log(`  ${child}`);
      }
      console.log("revoked", id);
    } else {
      console.error(
        `unknown keys subcommand "${sub}" (want create, list or revoke)`
      );
      process.exit(1);
    }
    await store.close();
  }
}
