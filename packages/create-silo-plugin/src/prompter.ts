import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Style } from "./style";

/** One selectable answer. Lives here because nothing else constructs one. */
export interface Choice<T> {
  value: T;
  label: string;
  summary?: string;
}

/**
 * The question-and-answer loop, over `node:readline` and nothing else.
 *
 * Every choice is a **numbered list read back as digits** rather than an
 * arrow-key selector. The selector is nicer in iTerm and unusable everywhere
 * else this actually runs: raw-mode keypress handling is what makes
 * `npx`-through-a-pipe, Git Bash on Windows, and every CI shell either garble
 * the screen or hang waiting for a keypress that cannot arrive. Digits work in
 * all of them, and are the only form that stays legible in a transcript when
 * someone pastes their session into a bug report.
 */
export class Prompter {
  private readonly rl = readline.createInterface({ input: stdin, output: stdout });

  /** Whether prompting is possible at all. A non-TTY stdin has nobody to
   *  answer, so `Cli` takes the defaults-only path instead of hanging on a
   *  read that will never return. */
  static get interactive(): boolean {
    return stdin.isTTY === true;
  }

  async text(label: string, fallback?: string): Promise<string> {
    const hint = fallback === undefined ? "" : Style.dim(` (${fallback})`);
    const answer = (await this.rl.question(`${Style.cyan("?")} ${label}${hint} `)).trim();
    if (answer.length > 0) return answer;
    if (fallback !== undefined) return fallback;
    return this.text(label, fallback);
  }

  async confirm(label: string, fallback: boolean): Promise<boolean> {
    const hint = Style.dim(fallback ? " (Y/n)" : " (y/N)");
    const answer = (await this.rl.question(`${Style.cyan("?")} ${label}${hint} `)).trim().toLowerCase();
    if (answer.length === 0) return fallback;
    return answer.startsWith("y");
  }

  /** One of. Re-asks on anything that is not a listed number, because a typo'd
   *  choice silently becoming the default is how someone ends up with a
   *  provider plugin they did not ask for. */
  async choose<T>(label: string, choices: readonly Choice<T>[], fallback = 0): Promise<T> {
    this.list(label, choices);
    const answer = await this.text(`${label}?`, String(fallback + 1));
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
      stdout.write(`${Style.red("!")} pick a number between 1 and ${choices.length}\n`);
      return this.choose(label, choices, fallback);
    }
    return choices[index]!.value;
  }

  /** Any of, as `1,3`. An empty answer takes `fallback`, which is what makes
   *  "just press enter" a working path through every question. */
  async chooseMany<T>(label: string, choices: readonly Choice<T>[], fallback: readonly T[]): Promise<T[]> {
    this.list(label, choices);
    const defaults = fallback
      .map((value) => choices.findIndex((choice) => choice.value === value) + 1)
      .filter((n) => n > 0)
      .join(",");

    const answer = await this.text(`${label}? ${Style.dim("(comma-separated)")}`, defaults);
    const picked: T[] = [];
    for (const part of answer.split(",").map((p) => p.trim()).filter(Boolean)) {
      const index = Number(part) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
        stdout.write(`${Style.red("!")} "${part}" is not one of 1-${choices.length}\n`);
        return this.chooseMany(label, choices, fallback);
      }
      // Deduped as it is built: `1,1` is a slip, not a request for two.
      if (!picked.includes(choices[index]!.value)) picked.push(choices[index]!.value);
    }
    return picked;
  }

  private list<T>(label: string, choices: readonly Choice<T>[]): void {
    stdout.write(`\n${Style.bold(label)}\n`);
    for (const [i, choice] of choices.entries()) {
      const summary = choice.summary ? Style.dim(`  ${choice.summary}`) : "";
      stdout.write(`  ${Style.cyan(String(i + 1))}. ${choice.label}${summary}\n`);
    }
  }

  close(): void {
    this.rl.close();
  }
}
