/**
 * The first-boot root key announcement.
 *
 * This is the one moment silo hands over a credential that can never be shown
 * again (§8), and it happens in the middle of startup logging where it is easy
 * to scroll past. The banner exists to make it impossible to miss and obvious
 * where the secret starts and ends — the box is a selection guide as much as
 * decoration.
 *
 * Two renderings, chosen by whether anything is watching: a coloured, boxed one
 * for a terminal, and the original flat ASCII for everything else. A log file,
 * a CI transcript or a `serve > out.txt` gets stable, greppable text with no
 * escape codes and no characters a legacy console might mangle.
 */
export class BootstrapBanner {
  /** The barrel glyph from the admin UI's `SiloMark`: a banded cylinder. */
  private static readonly mark = [
    "╭─────╮",
    "│     │",
    "├─────┤",
    "│     │",
    "╰─────╯",
  ];

  /**
   * Authored one cell per pixel and drawn two columns wide, because a terminal
   * cell is about twice as tall as it is wide — at 1:1 the letters come out
   * squashed, and the source is far easier to edit than 40-character rows.
   */
  private static readonly wordmark = [
    "█████ ███ █    █████",
    "█      █  █    █   █",
    "█████  █  █    █   █",
    "    █  █  █    █   █",
    "█████ ███ ████ █████",
  ].map((row) => row.replace(/./g, (cell) => cell + cell));

  /** Vertical fade across the wordmark, indigo → lilac, off the UI's `--accent`. */
  private static readonly fade: [number, number, number][] = [
    [107, 118, 255],
    [124, 134, 255],
    [141, 150, 255],
    [158, 166, 255],
    [175, 182, 255],
  ];

  private static readonly accent: [number, number, number] = [124, 134, 255];
  private static readonly secret: [number, number, number] = [205, 210, 255];
  private static readonly warn: [number, number, number] = [231, 181, 103];
  private static readonly dim: [number, number, number] = [108, 116, 130];

  private static readonly Reset = "\x1b[0m";
  private static readonly Bold = "\x1b[1m";

  private static rgb(text: string, [r, g, b]: [number, number, number], bold = false): string {
    return `${bold ? BootstrapBanner.Bold : ""}\x1b[38;2;${r};${g};${b}m${text}${BootstrapBanner.Reset}`;
  }

  /**
   * Whether to emit escape codes. `NO_COLOR` (any non-empty value) wins over
   * everything per the convention; `FORCE_COLOR` is how a wrapper that owns a
   * pty asks for them anyway.
   */
  private static colorful(stream: { isTTY?: boolean }): boolean {
    const no = process.env.NO_COLOR;
    if (no !== undefined && no !== "") return false;
    const force = process.env.FORCE_COLOR;
    if (force !== undefined && force !== "" && force !== "0") return true;
    return stream.isTTY === true;
  }

  /** The flat form: what a log file, a pipe or a dumb terminal receives. */
  private static plain(key: string): string {
    const line = "=".repeat(64);
    return (
      `\n${line}\n First run — root API key (shown only this once):\n\n` +
      `   ${key}\n\n Store it safely. Create more keys with: silo keys create\n${line}\n\n`
    );
  }

  private static fancy(key: string): string {
    const label = "ROOT API KEY";
    const note = "shown only once";
    // Two spaces of padding each side, three before the secret so it sits
    // clear of the border when double-clicked.
    const inner = Math.max(key.length + 6, label.length + note.length + 8);
    const pad = (content: string) => content + " ".repeat(inner - content.length);

    const border = (left: string, fill: string, right: string) =>
      BootstrapBanner.rgb(left + fill.repeat(inner) + right, BootstrapBanner.accent);
    const bar = BootstrapBanner.rgb("│", BootstrapBanner.accent);
    const row = (content: string) => `  ${bar}${content}${bar}`;

    const gap = inner - 2 - label.length - note.length - 2;
    const heading =
      "  " +
      BootstrapBanner.rgb(label, [233, 235, 239], true) +
      " ".repeat(gap) +
      BootstrapBanner.rgb(note, BootstrapBanner.warn) +
      "  ";

    const lines: string[] = [""];
    for (let i = 0; i < BootstrapBanner.wordmark.length; i++) {
      lines.push(
        "  " +
          BootstrapBanner.rgb(BootstrapBanner.mark[i], BootstrapBanner.accent) +
          "   " +
          BootstrapBanner.rgb(BootstrapBanner.wordmark[i], BootstrapBanner.fade[i]),
      );
    }
    lines.push("");
    lines.push("  " + border("╭", "─", "╮"));
    lines.push(row(heading));
    lines.push("  " + border("├", "─", "┤"));
    lines.push(row(pad("")));
    lines.push(row("   " + BootstrapBanner.rgb(key, BootstrapBanner.secret, true) + " ".repeat(inner - key.length - 3)));
    lines.push(row(pad("")));
    lines.push("  " + border("╰", "─", "╯"));
    lines.push("");
    lines.push("  " + BootstrapBanner.rgb("Store it now — only the SHA-256 hash is kept.", BootstrapBanner.dim));
    lines.push("  " + BootstrapBanner.rgb("Create more keys with: ", BootstrapBanner.dim) + BootstrapBanner.rgb("silo keys create", BootstrapBanner.accent));
    lines.push("");
    lines.push("");
    return lines.join("\n");
  }

  static render(key: string, stream: { isTTY?: boolean } = process.stderr): string {
    return BootstrapBanner.colorful(stream) ? BootstrapBanner.fancy(key) : BootstrapBanner.plain(key);
  }
}
