import { describe, expect, test, afterEach } from "bun:test";
import { BootstrapBanner } from "../../src/cli/bootstrap-banner";

const KEY = "silo_aRm10hJSPD4h4FjBoEYn3bO1sKWPze56Pn5OmnM2aoU";
const ANSI = /\x1b\[[0-9;]*m/g;

const BOX = /^ {2}[╭│├╰].*[╮│┤╯]$/;

const saved = { no: process.env.NO_COLOR, force: process.env.FORCE_COLOR };
afterEach(() => {
  if (saved.no === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = saved.no;
  if (saved.force === undefined) delete process.env.FORCE_COLOR;
  else process.env.FORCE_COLOR = saved.force;
});

describe("BootstrapBanner", () => {
  test("a pipe gets flat, escape-free text", () => {
    delete process.env.FORCE_COLOR;
    const out = BootstrapBanner.render(KEY, { isTTY: false });
    expect(out).not.toMatch(ANSI);
    expect(out).toContain(KEY);
    expect(out).toContain("shown only this once");
  });

  test("a terminal gets the coloured banner", () => {
    delete process.env.NO_COLOR;
    const out = BootstrapBanner.render(KEY, { isTTY: true });
    expect(out).toMatch(ANSI);
    expect(out).toContain(KEY);
  });

  test("NO_COLOR wins over FORCE_COLOR", () => {
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    expect(BootstrapBanner.render(KEY, { isTTY: true })).not.toMatch(ANSI);
    // An empty NO_COLOR is not set, per the convention.
    process.env.NO_COLOR = "";
    expect(BootstrapBanner.render(KEY, { isTTY: false })).toMatch(ANSI);
  });

  /**
   * The box is a selection guide — a row that is one cell out makes the secret
   * look like it has trailing whitespace in it. Padding is computed from
   * lengths that the colour codes are *not* part of, which is exactly the sort
   * of arithmetic that rots silently, so pin the rendered widths.
   *
   * Matched by a box character at *both* ends: the logo rows above the box
   * open with the same glyphs (the mark is a drawn cylinder) but end in a
   * block, so anchoring only the left edge counts them too.
   */
  test("every box row is the same visible width", () => {
    delete process.env.NO_COLOR;
    const rows = BootstrapBanner.render(KEY, { isTTY: true })
      .split("\n")
      .map((line) => line.replace(ANSI, ""))
      .filter((line) => BOX.test(line));
    expect(rows.length).toBe(7);
    const widths = new Set(rows.map((row) => [...row].length));
    expect(widths.size).toBe(1);
  });

  test("the secret survives intact and unbroken on one line", () => {
    delete process.env.NO_COLOR;
    const line = BootstrapBanner.render(KEY, { isTTY: true })
      .split("\n")
      .map((row) => row.replace(ANSI, ""))
      .find((row) => row.includes("silo_"));
    expect(line).toBeDefined();
    expect(line).toContain(KEY);
  });

  test("the box grows with a longer key rather than clipping it", () => {
    delete process.env.NO_COLOR;
    const long = "silo_" + "x".repeat(120);
    const rows = BootstrapBanner.render(long, { isTTY: true })
      .split("\n")
      .map((row) => row.replace(ANSI, ""));
    expect(rows.find((row) => row.includes(long))).toBeDefined();
    const widths = new Set(rows.filter((row) => BOX.test(row)).map((row) => [...row].length));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBeGreaterThan(long.length);
  });
});
