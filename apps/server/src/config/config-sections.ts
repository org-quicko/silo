import type { ConfigSection } from "./config-section";

/**
 * Every table of `silo.toml` the settings API knows about (D47).
 *
 * The catalogue, and the one place a new setting has to be added. `ConfigLoader`
 * is the other side of it: a field here that the loader does not read would
 * save cleanly and do nothing, and a `SILO_*` variable the loader reads that is
 * missing here would beat the file with nothing on screen admitting it. A test
 * pins both directions.
 *
 * `[blob_storage]` and `[media]` are deliberately absent. They have their own
 * routes under `/api/media/` (D45, D46) because they belong to the media page
 * and because repointing a store is a live operation with a rollback, not a
 * field write — this API writes the file and says what needs a restart.
 *
 * `[[plugins]]` is absent for a stronger reason: it decides what code runs, and
 * `PluginBlockWriter` and the grant model exist to make that a reviewed
 * decision rather than a text field (D42/D43).
 */
export class ConfigSections {
  static readonly All: readonly ConfigSection[] = [
    {
      table: "log",
      title: "Logging",
      summary: "How much the server writes down, in what format, and where.",
      writable: true,
      fields: [
        {
          key: "level",
          type: "enum",
          values: ["debug", "info", "warn", "error", "silent"],
          env: "SILO_LOG_LEVEL",
          label: "Level",
          help: "Applies immediately, so a debug session needs no restart.",
        },
        {
          key: "format",
          type: "enum",
          values: ["text", "json"],
          env: "SILO_LOG_FORMAT",
          label: "Format",
          help: "json is one object per line, for a log shipper.",
        },
        {
          key: "requests",
          type: "boolean",
          env: "SILO_LOG_REQUESTS",
          label: "Log every request",
          help: "High volume. Its own switch rather than a level.",
        },
        {
          key: "file",
          type: "string",
          env: "SILO_LOG_FILE",
          restart: true,
          label: "File",
          help: "Empty means the console. A detached run derives one under the data directory.",
        },
        {
          key: "max_size_mb",
          type: "number",
          min: 0,
          zeroMeans: "never rotate",
          env: "SILO_LOG_MAX_SIZE_MB",
          restart: true,
          label: "Rotate at",
          help: "Megabytes.",
        },
        {
          key: "max_files",
          type: "number",
          min: 0,
          env: "SILO_LOG_MAX_FILES",
          restart: true,
          label: "Keep",
          help: "Rotated files.",
        },
      ],
    },
    {
      table: "search",
      title: "Search",
      summary: "The full-text index, and the budget for instances running without one.",
      writable: true,
      fields: [
        {
          key: "enabled",
          type: "boolean",
          env: "SILO_SEARCH_ENABLED",
          restart: true,
          label: "Keep an index",
          help: "Off drops any index a previous run left, so it cannot rot into wrong answers.",
        },
        {
          key: "tokenizer",
          type: "enum",
          values: ["unicode61", "trigram"],
          env: "SILO_SEARCH_TOKENIZER",
          restart: true,
          label: "Tokenizer",
          help: "unicode61 splits words. trigram matches substrings and is required for CJK. Changing it rebuilds the index.",
        },
        {
          key: "max_entry_bytes",
          type: "number",
          min: 1,
          restart: true,
          label: "Indexed text per entry",
          help: "Bytes. Caps how much of one entry is indexed, so a huge field cannot crowd out the rest.",
        },
        {
          key: "scan_limit",
          type: "number",
          min: 1,
          restart: true,
          label: "Scan limit",
          help: "Entries one un-indexed search may visit before truncating.",
        },
        {
          key: "scan_time_budget_ms",
          type: "number",
          min: 1,
          restart: true,
          label: "Scan time budget",
          help: "Milliseconds, whichever comes first.",
        },
      ],
    },
    {
      table: "schema",
      title: "Schema validation",
      summary: "What a schema may reach for while it is being validated.",
      writable: true,
      fields: [
        {
          key: "allow_remote_refs",
          type: "boolean",
          env: "SILO_SCHEMA_ALLOW_REMOTE_REFS",
          restart: true,
          label: "Fetch remote $refs",
          help: "Makes validation reach the network, so a write stops being deterministic and a $ref decides what this server requests.",
        },
      ],
    },
    {
      table: "auth",
      title: "Authentication",
      summary: "Whether API keys are checked at all.",
      writable: true,
      tightenOnly: true,
      fields: [
        {
          key: "disabled",
          type: "boolean",
          env: "SILO_AUTH_DISABLED",
          restart: true,
          label: "Disabled",
          help: "Dev only: every request is treated as root. It can be switched back on here but never off, since an API that could disable its own authentication is not one.",
        },
      ],
    },
    {
      table: "storage",
      title: "Data storage",
      summary: "Where the instance itself lives. Reported here, changed by starting it elsewhere.",
      writable: false,
      fields: [
        {
          key: "driver",
          type: "enum",
          values: ["sqlite", "fs"],
          env: "SILO_STORAGE_DRIVER",
          readOnly: true,
          restart: true,
          label: "Driver",
        },
        {
          key: "path",
          type: "string",
          env: "SILO_STORAGE_PATH",
          readOnly: true,
          restart: true,
          label: "Data directory",
          help: "Also where media goes with the fs blob driver, unless a path is named.",
        },
      ],
    },
  ];

  static find(table: string): ConfigSection | null {
    return ConfigSections.All.find((section) => section.table === table) ?? null;
  }
}
