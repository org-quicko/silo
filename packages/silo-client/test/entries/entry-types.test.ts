import { describe, expect, test } from "bun:test";
import type { CollectionHandle } from "../../src/collections/collection-handle";
import type { Entry } from "../../src/entries/entry";

interface Post {
  title: string;
  status: "draft" | "published";
}

/**
 * Compile-time only: never called. `bun test` never runs this body — these
 * lines exist purely for `tsc`, and prove the two claims the entry type makes:
 * a row is the author's fields and the envelope in one flat object, and a
 * typed collection types its filter.
 */
function typeOnlyAssertions(posts: CollectionHandle<Post>, entry: Entry<Post>): void {
  // @ts-expect-error -- "stauts" is not `keyof Post`, so a typed filter must not accept it.
  posts.filter.field("stauts");

  // Fields and envelope sit at one level, and both are typed.
  const title: string = entry.title;
  const status: "draft" | "published" = entry.status;
  const id: string = entry.id;
  const rev: number = entry.rev;

  // The timestamps are the wire's: snake_case, and strings rather than Dates.
  const createdAt: string = entry.created_at;

  // @ts-expect-error -- there is no `fields` wrapper any more.
  entry.fields;

  // @ts-expect-error -- nor any method on a row: writes go through the collection.
  entry.save();

  // @ts-expect-error -- `rev` is required by replace(), so it cannot be skipped.
  posts.replace(entry.id, { title: "x", status: "draft" });

  void [title, status, id, rev, createdAt];
}

void typeOnlyAssertions;

describe("type-level assertions", () => {
  test("this file's role is to typecheck, not to run", () => {
    expect(typeof typeOnlyAssertions).toBe("function");
  });
});
