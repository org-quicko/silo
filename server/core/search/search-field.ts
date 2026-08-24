/** One piece of indexable text and the path it came from. */
export interface SearchField {
  /** The concrete D29 path of the node, e.g. `$.data.blocks[0].text`. */
  path: string;
  text: string;
  /** True when `x-silo-search.label` promoted it to the weighted column. */
  label: boolean;
}
