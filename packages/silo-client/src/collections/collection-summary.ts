/** One collection as the listing answers it: no schema, which is the one
 * thing a list of collections never needs to draw. */
export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly entries: number;
  readonly requiresAuth: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
