import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import type { McpTool } from "./mcp-tool";
import { McpInvalidParamsError } from "./mcp-invalid-params-error";

/**
 * Checks a call's arguments against the tool's own `inputSchema`, compiled
 * once per tool. A wrong shape is a protocol error (`-32602`) rather than a
 * tool result: the route was never reached, so there is nothing it refused.
 */
export class McpArgumentValidator {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });
  private readonly compiled = new Map<string, ValidateFunction>();

  /** The arguments as an object, or a thrown `McpInvalidParamsError` naming each problem. */
  check(tool: McpTool, args: unknown): Record<string, unknown> {
    const value = args === undefined ? {} : args;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new McpInvalidParamsError(`tool "${tool.name}": arguments must be an object`);
    }

    const validate = this.compile(tool);
    if (validate(value)) return value as Record<string, unknown>;

    const problems = (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "invalid",
    }));
    const summary = problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ");
    throw new McpInvalidParamsError(`tool "${tool.name}": invalid arguments (${summary})`, problems);
  }

  private compile(tool: McpTool): ValidateFunction {
    let validate = this.compiled.get(tool.name);
    if (!validate) {
      validate = this.ajv.compile(tool.inputSchema);
      this.compiled.set(tool.name, validate);
    }
    return validate;
  }
}
