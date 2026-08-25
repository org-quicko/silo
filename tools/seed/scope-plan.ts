import type { CollectionBlueprint } from "./collection-blueprint";

export interface CollectionPlan {
  blueprint: CollectionBlueprint;
  entries: number;
}

export interface ScopePlan {
  project: string;
  env: string;
  collections: CollectionPlan[];
}
