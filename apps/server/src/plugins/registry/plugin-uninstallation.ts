import type { Config } from "../../config/config";
import { PluginBlockWriter } from "../../config/plugin-block-writer";
import { NotFoundError } from "../../core/errors/not-found-error";
import { ValidationError } from "@silo/shared/validation-error";
import { PluginGrantService } from "../../core/services/plugin-grant-service";
import type { GrantRequest } from "../../core/services/support/grant-request";
import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import { PluginInstaller } from "../install/plugin-installer";
import type { PluginLifecycle } from "./plugin-lifecycle";
import { PluginRegistry } from "./plugin-registry";

export interface PluginUninstallOutcome {
  name: string;
  /** What the record held at the moment it went, so the answer can say what
   *  was taken away rather than that something was. */
  withdrawn: string[];
  /** Whether an entry was taken out of `silo.toml`. `false` for a package the
   *  file never listed. */
  unlisted: boolean;
  /** Whether a `_plugins` record was destroyed. `false` for a package that had
   *  never been loaded, which has none. */
  forgotten: boolean;
  /** Whether the package left `<data dir>/plugins/`. */
  removed: boolean;
  /** The config in force with the plugin gone — the supervisor's next
   *  `this.config`. */
  config: Config;
  warnings: string[];
}

export interface PluginUninstallationOptions {
  lifecycle: PluginLifecycle;
  registry: PluginRegistry;
  service: SiloService;
  logger: Logger;
  config: Config;
  /** Path to `silo.toml`, when this process was started from one. */
  configPath?: string;
  name: string;
  /** The authority and identity of whoever asked, plus the revision they read. */
  request: GrantRequest;
}

/**
 * Taking a plugin off this instance entirely — listing, record, key and
 * package (D43).
 *
 * The inverse of `PluginInstallation`, and it inherits the rule that decides
 * every ordering question there:
 *
 * > **The record must never describe a state the next `serve` cannot reach.**
 *
 * Read backwards, that puts the steps in this order, and each one is the one
 * whose failure leaves the least damage:
 *
 *  1. **Refuse on the revision first.** A stale `If-Match` must not cost a
 *     managed key on its way to a 409, which is the same split `revoke` and
 *     `setEnabled` already make.
 *  2. **Un-list it, and fail hard if that cannot be done.** A `[[plugins]]`
 *     block naming a package that is no longer on disk makes the next `serve`
 *     refuse the *whole instance* — `PluginLoader.loadExtensions` has no
 *     per-plugin rescue — so an uninstall that could not edit the file is an
 *     uninstall that must not proceed. Every other step is survivable.
 *  3. Stop the worker.
 *  4. Forget the record, which discards the managed key with it. After this,
 *     re-installing the package starts it `pending` and unapproved, which is
 *     the property that makes uninstall a real remedy rather than a tidy-up: a
 *     package that comes back does not come back with its old authority.
 *  5. **Delete the package last, and forgive it.** A directory nothing lists
 *     and nothing has a record for is inert; on Windows it is also the step
 *     most likely to lose to a file handle the worker has not let go of yet.
 *     Reported as a warning, not raised as a failure.
 *
 * There is no `keep_files` option, and that is deliberate. The half-way state
 * it would create — a package on disk that no config lists — is precisely what
 * `rescan` cannot see and what an operator would later find and re-list without
 * a record explaining why it was ever taken out.
 */
export class PluginUninstallation {
  static async run(options: PluginUninstallationOptions): Promise<PluginUninstallOutcome> {
    const name = typeof options.name === "string" ? options.name.trim() : "";
    if (!name) throw new ValidationError("plugin name is required");

    const listed = options.config.plugins.some((plugin) => plugin.name === name);
    const record = await options.service.plugins.find(name);
    const onDisk = await PluginInstaller.installed(PluginRegistry.directory(options.config), name);

    if (!listed && !record && !onDisk) {
      throw new NotFoundError(
        `plugin "${name}" is not listed in silo.toml, has no record on this instance, and is ` +
          `not in the plugins directory. There is nothing to uninstall.`
      );
    }

    // Before the file is touched, for the same reason `PluginSupervisor`
    // pre-checks it: the store checks the revision again under its own lock,
    // which is the authoritative one, and this is only so the common refusal
    // costs nothing.
    //
    // The `If-Match` is demanded **here** rather than at the route, because only
    // this far in is it known whether there is a record to demand one about. A
    // package with no record — a provider-only install (§13.7), or one listed
    // and never loaded — has no revision anybody could send, and requiring one
    // would make it uninstallable through the API that installed it.
    if (record) {
      if (options.request.expectedRev === undefined) {
        throw new ValidationError(
          `missing expected rev: send If-Match: "<rev>" or ?rev=<rev>. Uninstalling "${name}" ` +
            `destroys its grant, and the revision is what says the grant being destroyed is the ` +
            `one you read.`
        );
      }
      PluginGrantService.assertRev(name, record.rev, options.request.expectedRev);
    }

    const unlisted = await PluginUninstallation.unlist(options, name, listed);
    const config: Config = listed
      ? { ...options.config, plugins: options.config.plugins.filter((each) => each.name !== name) }
      : options.config;

    await options.lifecycle.remove(name);

    const withdrawn = record ? [...record.granted] : [];
    if (record) await options.service.plugins.forget(name, options.request);

    const warnings: string[] = [];
    let removed = false;
    if (onDisk) {
      try {
        await PluginInstaller.uninstall(PluginRegistry.directory(options.config), name);
        removed = true;
      } catch (caught) {
        warnings.push(
          `${name} is no longer listed, running or granted, but its files could not be ` +
            `deleted (${PluginUninstallation.message(caught)}). Nothing loads them; remove the ` +
            `directory by hand when whatever is holding it lets go.`
        );
      }
    }

    options.logger.info("plugin uninstalled", {
      name,
      unlisted: String(unlisted),
      forgotten: String(Boolean(record)),
      removed: String(removed),
      withdrawn: withdrawn.length,
    });

    return { name, withdrawn, unlisted, forgotten: Boolean(record), removed, config, warnings };
  }

  /**
   * Take the `[[plugins]]` entry out, or say why the uninstall cannot go ahead
   * without doing so.
   *
   * The one hard failure in the sequence. A process started without a config
   * file has no entry to remove and nothing to refuse; a process that *has* one
   * and cannot edit it would be leaving a block pointing at a package it is
   * about to delete, and that block is what stops the next `serve` from
   * starting at all.
   */
  private static async unlist(
    options: PluginUninstallationOptions,
    name: string,
    listed: boolean
  ): Promise<boolean> {
    if (!options.configPath) {
      if (!listed) return false;
      throw new ValidationError(
        `this process was not started from a config file, so the [[plugins]] entry for ` +
          `"${name}" cannot be removed — and deleting the package while something still ` +
          `lists it would stop the next start. Remove the entry from your silo.toml first.`
      );
    }
    if (!(await PluginBlockWriter.exists(options.configPath))) return false;

    try {
      return await PluginBlockWriter.remove(options.configPath, name);
    } catch (caught) {
      throw new ValidationError(
        `${options.configPath} could not be edited, so nothing was uninstalled: ` +
          `${PluginUninstallation.message(caught)}`
      );
    }
  }

  private static message(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
