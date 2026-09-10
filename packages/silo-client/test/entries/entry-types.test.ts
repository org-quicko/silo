import { describe, expect, test } from "bun:test";
import type { CollectionHandle } from "../../src/collections/collection-handle";
import type { ResolvedEntry } from "../../src/entries/resolved-entry";

interface Post {
  title: string;
  status: "draft" | "published";
}

/**
 * Compile-time only: never called. `bun test` never runs this body — a
 * `resolved.save()` call would throw at runtime, since `ResolvedEntry`
 * genuinely has no such method — so these lines exist purely for `tsc` to
 * check, proving the resolved and editable split and the typed filter
 * hold at the type level.
 */
function typeOnlyAssertions(posts: CollectionHandle<Post>, resolved: ResolvedEntry<Post>): void {
  // @ts-expect-error -- "stauts" is not `keyof Post`, so a typed filter must not accept it.
  posts.filter.field("stauts");

  // @ts-expect-error -- ResolvedEntry has no save(): a resolved read is not editable.
  resolved.save();

  // @ts-expect-error -- nor refresh().
  resolved.refresh();
}

void typeOnlyAssertions;

describe("type-level assertions", () => {
  test("this file's role is to typecheck, not to run", () => {
    expect(typeof typeOnlyAssertions).toBe("function");
  });
});
