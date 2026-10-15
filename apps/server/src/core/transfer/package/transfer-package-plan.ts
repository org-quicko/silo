import type { CollectionRecord } from "../../domain/collection-record";
import type { EnvironmentRecord } from "../../domain/environment-record";
import type { ProjectRecord } from "../../domain/project-record";
import type { TransferPackageSelection } from "./transfer-package-selection";

/** A selection whose scope, collections and entries were all found to exist. */
export interface TransferPackagePlan {
  selection: TransferPackageSelection;
  project: ProjectRecord;
  environment: EnvironmentRecord;
  /** One record per selected collection, sorted by name. */
  collections: CollectionRecord[];
}
