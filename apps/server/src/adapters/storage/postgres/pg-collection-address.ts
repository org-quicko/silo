/**
 * Where one collection's rows live, by id and by name.
 *
 * The same shape as the SQLite adapter's `CollectionAddress`, kept separate so
 * neither adapter imports the other.
 */
export interface PgCollectionAddress {
  projectId: string;
  envId: string;
  collectionId: string;
  project: string;
  env: string;
  collection: string;
}
