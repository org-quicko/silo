export interface Entry {
  id: string;
  project: string;
  env: string;
  collection: string;
  rev: number;
  seq: number;
  created_at: Date;
  updated_at: Date;
  data: any;
}
