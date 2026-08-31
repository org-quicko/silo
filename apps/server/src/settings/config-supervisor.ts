import fs from "fs/promises";
import { ValidationError } from "@silo/shared/validation-error";
import type { Config } from "../config/config";
import type { ConfigSection } from "../config/config-section";
import { ConfigSections } from "../config/config-sections";
import { SectionTable } from "../config/section-table";
import type { AuditActor } from "../core/audit/audit-actor";
import { AsyncMutex } from "../core/services/support/async-mutex";
import type { SiloService } from "../core/services/silo-service";
import type { Logger } from "../logging/logger";
import { ConfigSectionSettings } from "./config-section-settings";
import type { ConfigSectionView } from "./config-section-view";
import type { ConfigSettingsView } from "./config-settings-view";

export interface ConfigSupervisorOptions {
  service: SiloService;
  /** The config this process **started on**, which is not the same thing as
   *  what the file now says — the difference is the point (see `running`). */
  config: Config;
  logger: Logger;
  /** Re-read `silo.toml` the way this process was started, flags and
   *  environment included. Absent in a process handed no file, where a save
   *  refuses rather than writing somewhere it invented. */
  reload?: () => Promise<Config>;
  configPath?: string;
}

/**
 * Reading and changing the rest of `silo.toml` from the API (D47).
 *
 * The third of these, after `[blob_storage]` (D45) and `[media]` (D46), and the
 * first that cannot always apply what it saves. `MediaStorageSupervisor` swaps a
 * store; a tokenizer change rebuilds an index at boot and a log file is a handle
 * opened once. So this one is honest about the difference instead of pretending:
 * a field is marked `restart` in `ConfigSections` or it is not, and what is not
 * takes effect on the next line written.
 *
 * That is why there are **two** configs here rather than one. `running` is what
 * the process is actually doing and only changes where something was genuinely
 * applied; the file is read fresh on every view. A field where they disagree is
 * a restart owed, which is exactly what the page needs to say — and reporting
 * the freshly-reloaded value as "in force" would be the one lie this whole
 * design exists to avoid.
 *
 * D42/D43's rule still holds: **the file must never describe a state the next
 * `serve` cannot reach.** The file is written, then re-read the way a start
 * reads it, and a file that will not load puts the old one back and answers 400.
 */
export class ConfigSupervisor {
  private readonly service: SiloService;
  private readonly logger: Logger;
  private readonly reload?: () => Promise<Config>;
  private readonly configPath?: string;
  private readonly lock = new AsyncMutex();

  /** What this process is actually running on. Updated only for fields
   *  something applied, never merely because the file changed. */
  private running: Config;

  constructor(options: ConfigSupervisorOptions) {
    this.service = options.service;
    this.logger = options.logger;
    this.running = options.config;
    this.reload = options.reload;
    this.configPath = options.configPath;
  }

  async view(): Promise<ConfigSettingsView> {
    const sections: ConfigSectionView[] = [];
    for (const section of ConfigSections.All) {
      sections.push(await this.sectionView(section));
    }

    return {
      sections,
      ...(this.configPath ? { config_path: this.configPath } : {}),
      writable: this.writable(),
      restart_pending: sections.some((section) => section.restart_pending.length > 0),
    };
  }

  /** Write one table, apply what can be applied, and answer with the whole view
   *  a fresh `GET` would give — a save can change what another section reports. */
  async save(
    table: string,
    input: Record<string, unknown>,
    actor: AuditActor
  ): Promise<ConfigSettingsView> {
    const release = await this.lock.acquire();
    try {
      await this.apply(table, input, actor);
      return await this.view();
    } finally {
      release();
    }
  }

  private writable(): boolean {
    return !!this.configPath && !!this.reload;
  }

  private async sectionView(section: ConfigSection): Promise<ConfigSectionView> {
    const file = this.configPath ? await SectionTable.read(this.configPath, section) : null;
    const inForce = ConfigSupervisor.valuesOf(this.running, section);

    return {
      table: section.table,
      title: section.title,
      summary: section.summary,
      fields: section.fields,
      file: file ?? {},
      in_force: inForce,
      overrides: ConfigSectionSettings.overrides(section, file, inForce),
      writable: section.writable && this.writable(),
      // Against the file rather than against a fresh reload, so a table edited
      // by hand since the start is reported too. An env var cannot change under
      // a running process, so the file is the only thing that can have moved.
      restart_pending: ConfigSectionSettings.restartPending(section, file ?? {}, inForce),
    };
  }

  private async apply(
    table: string,
    input: Record<string, unknown>,
    actor: AuditActor
  ): Promise<void> {
    const section = ConfigSections.find(table);
    if (!section) throw new ValidationError(`no such settings section "${table}"`);

    if (!section.writable) {
      throw new ValidationError(
        `[${section.table}] is reported here, not changed here. ${section.summary}`
      );
    }

    const configPath = this.configPath;
    if (!configPath || !this.reload) {
      throw new ValidationError(
        `this process was not started from a config file, so there is nothing to write. ` +
          `Configure [${section.table}] where this instance is started from, or set the ` +
          `matching SILO_* environment variables.`
      );
    }

    ConfigSectionSettings.assertTightening(section, input);

    const file = await SectionTable.read(configPath, section);
    const next = ConfigSectionSettings.merge(file, input);

    const restore = await ConfigSupervisor.snapshot(configPath);
    const created = await SectionTable.write(configPath, section, next);

    let config: Config;
    try {
      config = await this.reload();
    } catch (caught) {
      await restore();
      throw new ValidationError(
        `${ConfigSupervisor.message(caught)} — ${configPath} was left as it was.`
      );
    }

    const applied = this.adopt(section, config);

    this.logger.info("settings changed", {
      section: section.table,
      applied: applied.join(",") || "(none)",
      ...(created ? { created: configPath } : {}),
    });

    await this.service.audit.record("settings.configure", actor, section.table, {
      ...next,
      config_path: configPath,
    });
  }

  /**
   * Take on the parts of a reloaded config this process can actually honour,
   * and report which.
   *
   * A field is adoptable exactly when it is **not** marked `restart`. Today
   * only `[log]` has any, and the applier is the logger — a section that grew a
   * non-restart field with nothing to apply it would be adopted into `running`
   * and reported as in force while nothing had changed, which is why the
   * catalogue test pins the two together.
   */
  private adopt(section: ConfigSection, config: Config): string[] {
    const live = section.fields.filter((field) => !field.restart);
    if (live.length === 0) return [];

    if (section.table === "log") this.logger.apply(config.log);

    const running = ConfigSupervisor.valuesOf(this.running, section);
    const next = ConfigSupervisor.valuesOf(config, section);
    const changed: string[] = [];

    for (const field of live) {
      if (JSON.stringify(running[field.key]) !== JSON.stringify(next[field.key])) {
        changed.push(field.key);
      }
      running[field.key] = next[field.key];
    }
    return changed;
  }

  /** A section's values out of a whole config. The table name **is** the config
   *  key — `[log]` is `config.log` — which is what lets one spec drive both. */
  private static valuesOf(config: Config, section: ConfigSection): Record<string, unknown> {
    return (config as unknown as Record<string, Record<string, unknown>>)[section.table] ?? {};
  }

  /**
   * A closure that puts the file back exactly as it was, including not being
   * there at all. Taken before the write rather than reconstructed after it,
   * because "what it was" includes the comments and layout `SectionTable`
   * preserved.
   */
  private static async snapshot(configPath: string): Promise<() => Promise<void>> {
    let before: string | null;
    try {
      before = await fs.readFile(configPath, "utf8");
    } catch {
      before = null;
    }

    return async () => {
      if (before === null) await fs.rm(configPath, { force: true }).catch(() => {});
      else await fs.writeFile(configPath, before, "utf8").catch(() => {});
    };
  }

  private static message(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
