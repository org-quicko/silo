import type { Config } from "../../config/config";
import type { Storage } from "../../core/ports/storage";

/** Builds a `Storage` from the whole config, because an adapter may need more
 *  than `[storage]` — SQLite reads `[search]` to decide whether to keep an
 *  index. */
export type StorageFactory = (cfg: Config) => Promise<Storage>;
