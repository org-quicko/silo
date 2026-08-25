/** Runs a child process, inheriting its output, and fails loudly. */
export class CommandRunner {
  static async run(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    const status = await child.exited;
    if (status !== 0) throw new Error(`${command[0]} exited with ${status}`);
  }
}
