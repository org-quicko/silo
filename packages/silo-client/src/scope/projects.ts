import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { Project } from "./project.js";

interface ProjectPayload {
  id: string;
  name: string;
}

/** Projects at the instance root: `list` and `create`. */
export class Projects {
  constructor(private readonly transport: Transport) {}

  async list(options: RequestOptions = {}): Promise<Project[]> {
    const body = await this.transport.json<{ items: ProjectPayload[] }>({
      method: "GET",
      path: ApiPath.projects(),
      ...options,
    });
    return body.items.map((item) => ({ id: item.id, name: item.name }));
  }

  async create(name: string, options: RequestOptions = {}): Promise<Project> {
    const payload = await this.transport.json<ProjectPayload>({
      method: "POST",
      path: ApiPath.projects(),
      body: { id: name },
      ...options,
    });
    return { id: payload.id, name: payload.name };
  }
}
