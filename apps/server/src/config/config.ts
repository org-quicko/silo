import type { StorageConfig } from "./storage-config";
import type { BlobStorageConfig } from "./blob-storage-config";
import type { MediaConfig } from "./media-config";
import type { AuthConfig } from "./auth-config";
import type { SchemaConfig } from "./schema-config";
import type { HttpConfig } from "./http-config";
import type { LogConfig } from "./log-config";
import type { SearchConfig } from "./search-config";
import type { PluginConfig } from "./plugin-config";
import type { TransferConfig } from "./transfer-config";
import type { TrashConfig } from "./trash-config";

export interface Config {
  listen: string;
  /** Connection-level settings for the listener the `listen` address binds. */
  http: HttpConfig;
  /** How large an archive arriving over the network may be and expand to (D85). */
  transfer: TransferConfig;
  /** How long a deleted thing stays recoverable (D91). */
  trash: TrashConfig;
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
