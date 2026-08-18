import { Service } from "../../core/service/service";
import { Claims } from "@silo/shared/claims";
import { KeyUtils } from "../../core/keys/key-utils";

export class KeysCommand {
  static async run(
    svc: Service,
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
      const { secret, entry } = await svc.createKey(labelStr, claims);
      console.log(
        `created key ${entry.id} (${claims.length} claim${claims.length === 1 ? "" : "s"})\n\n  ${secret}\n\nShown only this once.`
      );
    } else if (sub === "list") {
      const keys = await svc.listKeys();
      console.log(
        "ID".padEnd(28) +
          "LABEL".padEnd(20) +
          "CLAIMS".padEnd(48) +
          "PREFIX".padEnd(15) +
          "CREATED"
      );
      for (const e of keys) {
        const v = Service.newKeyView(e);
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
      await svc.revokeKey(id);
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
