#!/usr/bin/env node
import { Cli } from "./cli";

/**
 * The published entry point, and deliberately nothing more than one.
 *
 * The shebang says `node`, not `bun`: this package is installed and run by
 * whatever `npm create` / `npx` / `bunx` puts in front of it, and only Node is
 * guaranteed to be there. That is also why `bun build --target=node` produces
 * what ships — the source is TypeScript, the artifact is Node-compatible
 * JavaScript, and nothing in `src/` may reach for a `Bun.*` global.
 *
 * `process.exitCode` rather than `process.exit`: stdout may still be draining
 * into a pipe, and `exit` would truncate the report this tool exists to print.
 */
process.exitCode = await Cli.run(process.argv.slice(2));
