import { describe, expect, test } from "bun:test";
import { PageWindow } from "../../src/pagination/page-window";

describe("PageWindow", () => {
  test("next advances the offset by the limit", () => {
    const window = new PageWindow(50, 100);
    const next = window.next();
    expect(next.limit).toBe(50);
    expect(next.offset).toBe(150);
  });

  test("previous steps back by the limit", () => {
    const window = new PageWindow(50, 100);
    const previous = window.previous();
    expect(previous?.limit).toBe(50);
    expect(previous?.offset).toBe(50);
  });

  test("previous is null before the start", () => {
    expect(new PageWindow(50, 0).previous()).toBeNull();
  });

  test("previous never goes negative when offset is smaller than limit", () => {
    const previous = new PageWindow(50, 20).previous();
    expect(previous?.offset).toBe(0);
  });
});
