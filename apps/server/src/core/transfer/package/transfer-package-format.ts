/**
 * The fixed facts of a transfer package's layout (D108).
 *
 * The tree is the §6.3 export tree, cut to the selection. Its manifest is
 * `package.json` rather than `manifest.json`, so an ordinary import refuses a
 * package instead of loading a partial collection as if it were whole.
 */
export class TransferPackageFormat {
  static readonly Version = 1;
  static readonly Manifest = "package.json";
}
