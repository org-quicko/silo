/** A collection as the API answers it: its stable id, its mutable name, and
 *  its schema. `CollectionRecord` is the stored shape behind it (D51). */
export interface Collection {
  id: string;
  name: string;
  schema: any;
}
