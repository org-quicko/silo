import type { StorageConfig } from "./storage-config";
import type { BlobStorageConfig } from "./blob-storage-config";
import type { MediaConfig } from "./media-config";
import type { AuthConfig } from "./auth-config";
import type { SchemaConfig } from "./schema-config";
import type { HttpConfig } from "./http-config";
import type { LogConfig } from "./log-config";
import type { SearchConfig } from "./search-config";
import type { PluginConfig } from "./plugin-config";

export interface Config {
  listen: string;
  /** Connection-level settings for the listener the `listen` address binds. */
  http: HttpConfig;
  default_project: string;
  default_env: string;
  storage: StorageConfig;
  blob_storage: BlobStorageConfig;
  media: MediaConfig;
  auth: AuthConfig;
  schema: SchemaConfig;
  log: LogConfig;
  search: SearchConfig;
  /** Ordered (D31/§13.8): the array's order is hook dispatch order. Empty
   *  unless the file says otherwise — there is no env override, because a
   *  plugin is code and an environment variable is the wrong place to decide
   *  which code runs. */
  plugins: PluginConfig[];
}
