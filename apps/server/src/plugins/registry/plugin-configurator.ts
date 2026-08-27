import { MergePatch } from "@silo/shared/merge-patch";
import { ValidationError } from "@silo/shared/validation-error";
import type { Config } from "../../config/config";
import type { PluginConfig } from "../../config/plugin-config";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { GrantRequest } from "../../core/services/support/grant-request";
import type { SiloService } from "../../core/services/silo-service";
import { PluginConfigValidator } from "../manifest";
import { PluginLoader } from "./plugin-loader";
import type { PluginLifecycle } from "./plugin-lifecycle";
import { PluginRegistry } from "./plugin-registry";

/**
 * `PATCH` and `DELETE /api/plugins/{name}/config` (D39, phase 4).
 *
 * D38 deferred this with `rescan` for the same reason — it needs the manifest on
 * disk to validate against, and without a supervisor its whole answer would be
 * "restart to find out". Two decisions shape it.
 *
 * **The override replaces, it does not merge with the file.** Claims union the
 * two grant paths because claims are a set and a union is still a set; two
 * config *documents* have no such join, and `required` and
 * `additionalProperties` would end up judged against a value neither source
 * wrote. So `silo.toml`'s block applies until an override exists and is ignored
 * afterwards — the config analogue of `silo plugin revoke` clearing only the
 * stored half, and like it, every surface says which source is in force.
 *
 * **The patch itself is [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396).**
 * Changing one setting without restating the block, and removing one, are
 * exactly what that defines; inventing a shape here would be a proprietary field
 * language in the one repo that advertises having none. What is *stored* is the
 * result, not the patch, so the record holds a document rather than a recipe.
 */
export class PluginConfigurator {
  private readonly lifecycle: PluginLifecycle;
  private readonly service: SiloService;

  constructor(lifecycle: PluginLifecycle, service: SiloService) {
    this.lifecycle = lifecycle;
    this.service = service;
  }

  /** Merge `patch` over the config in force and apply the result. */
  async patch(
    config: Config,
    declared: PluginConfig,
    current: PluginGrantRecord,
    patch: Record<string, unknown>,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    const next = MergePatch.applyToObject(
      PluginGrantUtils.configFor(current, declared.config),
      patch
    );
    return await this.apply(config, declared, current, next, request);
  }

  /** Drop the override and go back to `silo.toml` — the only way out of the pin
   *  that setting one creates. */
  async clear(
    config: Config,
    declared: PluginConfig,
    current: PluginGrantRecord,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    return await this.apply(config, declared, current, undefined, request);
  }

  /**
   * Validate, restart with the new document, then record it.
   *
   * Restart before write, for the supervisor's rule: a record holding a config
   * the plugin cannot start with would make the next `serve` refuse the whole
   * instance, turning a failed management call into an unbootable server. If the
   * write is then refused — a stale `If-Match` — the previous config is put back,
   * and if *that* fails the plugin reports `failed` while the record still names
   * the config that worked, so a restart is the way home and a boot still works.
   *
   * A patch that changes nothing restarts nothing. Detected against the document
   * the worker was actually initialised with, not against the record, because
   * those differ for a plugin started before an override existed.
   */
  private async apply(
    config: Config,
    declared: PluginConfig,
    current: PluginGrantRecord,
    next: Record<string, unknown> | undefined,
    request: GrantRequest
  ): Promise<PluginGrantRecord> {
    const effective = next ?? declared.config;

    // Read the manifest — the whole reason this had to wait for a phase allowed
    // to read one — and judge the new document against the schema it declares.
    // A failure here is the *caller's* document being wrong, so it becomes a 400
    // rather than the plain `Error` a start throws on the way to refusing a
    // boot, where there is no caller to tell.
    const resolved = await PluginLoader.resolve(PluginRegistry.directory(config), declared);
    try {
      PluginConfigValidator.validate(resolved.manifest, effective);
    } catch (caught) {
      throw new ValidationError((caught as Error).message);
    }

    // `null` when nothing is running, in which case there is no restart to
    // perform and none to skip — the record is the only thing that changes.
    const running = this.lifecycle.runtimeConfig(declared.name);
    const bounced = running !== null && JSON.stringify(running) !== JSON.stringify(effective);
    if (bounced) {
      await this.lifecycle.remove(declared.name);
      // The override is passed explicitly: the record still holds the previous
      // one, and the whole point of restarting first is that it has not been
      // written yet.
      await this.lifecycle.spawn(config, declared, effective);
    }

    try {
      return await this.service.plugins.setConfig(declared.name, next, request);
    } catch (caught) {
      if (bounced) {
        await this.lifecycle.remove(declared.name).catch(() => {});
        await this.lifecycle
          .spawn(config, declared, PluginGrantUtils.configFor(current, declared.config))
          .catch(() => {});
      }
      throw caught;
    }
  }
}
