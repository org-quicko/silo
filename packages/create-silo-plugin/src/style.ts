/**
 * The five escape codes this tool uses, and the two rules for turning them off.
 *
 * No colour dependency: `chalk`/`picocolors` exist to solve Windows 7 consoles
 * and 256-colour downsampling, neither of which applies to five SGR codes on a
 * Node 18 floor. `NO_COLOR` is honoured because it is the standard, and a
 * non-TTY stdout is unstyled because the most common non-TTY reader of this
 * output is a file or a CI log, where escape codes are noise.
 */
export class Style {
  private static readonly enabled =
    process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

  private static wrap(code: string, text: string): string {
    return Style.enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
  }

  static bold(text: string): string { return Style.wrap("1", text); }
  static dim(text: string): string { return Style.wrap("2", text); }
  static cyan(text: string): string { return Style.wrap("36", text); }
  static green(text: string): string { return Style.wrap("32", text); }
  static red(text: string): string { return Style.wrap("31", text); }
}
