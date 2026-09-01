export interface Meta {
  instance_id: string;
  last_seq: number;
  /**
   * Whether the configured default project and environment have ever been
   * seeded (D51).
   *
   * Durable rather than derived from "does the instance hold any project",
   * because that reading resurrects the default the moment the last project is
   * deleted — and, once a name is mutable, the moment the default is renamed.
   */
  defaults_initialized: boolean;
}
