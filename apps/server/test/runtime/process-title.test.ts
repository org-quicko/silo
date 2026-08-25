import { describe, test, expect } from "bun:test";
import { ProcessTitle } from "../../src/runtime/process-title";

/**
 * The title is cosmetic, so what is worth pinning is not the operating
 * system's reaction to it — that differs per platform and is untestable on the
 * one platform where it does nothing — but the two properties every platform
 * needs: the name a process list is searched by comes first, and setting it
 * can never throw. A silo that failed to start because it could not rename
 * itself would be a far worse bug than an unhelpfully named one.
 */
describe("ProcessTitle", () => {
  test("leads with the name an operator greps for", () => {
    expect(ProcessTitle.format("127.0.0.1:4000")).toStartWith("silo");
  });

  test("says which instance, so several on one host are told apart", () => {
    expect(ProcessTitle.format(":4000")).not.toBe(ProcessTitle.format(":4001"));
  });

  test("never throws, whatever the platform makes of it", () => {
    const before = process.title;
    expect(() => ProcessTitle.set(":4000")).not.toThrow();
    process.title = before;
  });
});
