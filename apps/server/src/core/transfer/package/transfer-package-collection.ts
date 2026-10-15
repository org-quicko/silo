/** One collection a package carries: all of it, or exactly the entries named. */
export interface TransferPackageCollection {
  name: string;
  entryIds?: readonly string[];
}
