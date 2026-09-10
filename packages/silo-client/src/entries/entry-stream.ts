import { RowStream } from "../pagination/row-stream.js";

/** `collection.all()`'s return type: entries one at a time. Named for what
 *  it yields, though the paging behaviour is entirely {@link RowStream}'s. */
export class EntryStream<Row> extends RowStream<Row> {}
