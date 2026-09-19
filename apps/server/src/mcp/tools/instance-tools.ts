import type { McpTool } from "../mcp-tool";
import { ToolPaths } from "./tool-paths";
import { ToolSchemas } from "./tool-schemas";

/** The key itself, and the two containers above a collection: projects and environments. */
export class InstanceTools {
  static all(): McpTool[] {
    return [
      InstanceTools.whoami(),
      InstanceTools.listProjects(),
      InstanceTools.createProject(),
      InstanceTools.listEnvironments(),
      InstanceTools.createEnvironment(),
      InstanceTools.listVariables(),
    ];
  }

  private static whoami(): McpTool {
    return {
      name: "whoami",
      title: "Who am I",
      description:
        "The API key this connection uses: its label and its claims. Call this first to learn which projects and operations are open to you.",
      inputSchema: ToolSchemas.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: () => ({ method: "GET", path: "/api/session" }),
    };
  }

  private static listProjects(): McpTool {
    return {
      name: "list_projects",
      title: "List projects",
      description: "Projects this key can see. A project holds environments; an environment holds collections.",
      inputSchema: ToolSchemas.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: () => ({ method: "GET", path: "/api/projects" }),
    };
  }

  private static createProject(): McpTool {
    return {
      name: "create_project",
      title: "Create project",
      description: "Create an empty project. Needs collections:<project>/*/*:create.",
      inputSchema: ToolSchemas.object({ project: ToolSchemas.Project }, ["project"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      request: (args) => ({ method: "POST", path: "/api/projects", body: { id: args.project } }),
    };
  }

  private static listEnvironments(): McpTool {
    return {
      name: "list_environments",
      title: "List environments",
      description: "Environments of one project that this key can see.",
      inputSchema: ToolSchemas.object({ project: ToolSchemas.Project }, ["project"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({
        method: "GET",
        path: `/api/projects/${ToolPaths.text(args, "project")}/environments`,
      }),
    };
  }

  private static createEnvironment(): McpTool {
    return {
      name: "create_environment",
      title: "Create environment",
      description: "Create an empty environment in a project. Needs collections:<project>/<env>/*:create.",
      inputSchema: ToolSchemas.scoped({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      request: (args) => ({
        method: "POST",
        path: `/api/projects/${ToolPaths.text(args, "project")}/environments`,
        body: { id: args.env },
      }),
    };
  }

  private static listVariables(): McpTool {
    return {
      name: "list_variables",
      title: "List variables",
      description:
        "The variables declared in a project, with this environment's values. Entries reference one as {{NAME}} and reads resolve it.",
      inputSchema: ToolSchemas.scoped({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      request: (args) => ({ method: "GET", path: `${ToolPaths.scope(args)}/variables` }),
    };
  }
}
