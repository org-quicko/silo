/**
 * One rule of a transfer selection, addressing a project, one of its
 * environments, or one collection of one environment.
 *
 * The three depths are the three things an operator actually points at, and
 * they are the same three the archive tree already nests
 * (`projects/<project>/<env>/content/<collection>`). Entry-level subsets are
 * deliberately not here: they stay on the scoped copy route, where replace mode
 * cannot turn a partial collection into a deletion (§7.4.1).
 */
export interface TransferInclude {
  project: string;
  /** Absent means every environment of the project. */
  env?: string;
  /** Absent means every collection of the environment. */
  collection?: string;
}
