import type { StorageConfig } from "./storage-config";
import type { BlobStorageConfig } from "./blob-storage-config";
import type { AuthConfig } from "./auth-config";
import type { SchemaConfig } from "./schema-config";
import type { LogConfig } from "./log-config";

export interface Config {
  listen: string;
  default_project: string;
  default_env: string;
  storage: StorageConfig;
  blob_storage: BlobStorageConfig;
  auth: AuthConfig;
  schema: SchemaConfig;
  log: LogConfig;
}
