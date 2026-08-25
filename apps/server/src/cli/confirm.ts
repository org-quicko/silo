import readline from "readline/promises";

/**
 * The one interactive question silo's CLI asks (D32).
 *
 * Every other subcommand is a one-shot that reads its arguments and answers;
 * `silo add` is the only one that has to get consent for something the
 * arguments did not say, because the claims a plugin requests are not in the
 * spec the operator typed — they are in the package it just fetched, and
 * granting them is a security decision that should be made by someone looking
 * at the list.
 *
 * A non-interactive stdin is a **no**, never a yes. `silo add` in a CI job
 * therefore fails and names `--yes`, rather than granting whatever a package
 * happened to ask for because nobody was there to object.
 */
export class Confirm {
  static async ask(question: string, stream: { isTTY?: boolean } = process.stdin): Promise<boolean> {
    if (stream.isTTY !== true) return false;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  }

  /** Whether a question can be asked at all, so a caller can explain what to
   *  pass instead of printing a prompt into a pipe nobody will read. */
  static interactive(stream: { isTTY?: boolean } = process.stdin): boolean {
    return stream.isTTY === true;
  }
}
