import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { Environment } from "./environment.js";

/** The wire also carries `project_id`, which a caller already knows from the
 * handle it called this on — dropped rather than mapped (the mapper only maps
 * metadata a caller cannot already derive). */
interface EnvironmentPayload {
  id: string;
  name: string;
}

/** Environments within one project: `list` and `create`. */
export class Environments {
  constructor(
    private readonly transport: Transport,
    private readonly project: string,
  ) {}

  async list(options: RequestOptions = {}): Promise<Environment[]> {
    const body = await this.transport.json<{ items: EnvironmentPayload[] }>({
      method: "GET",
      path: ApiPath.environments(this.project),
      ...options,
    });
    return body.items.map((item) => ({ id: item.id, name: item.name }));
  }

  async create(name: string, options: RequestOptions = {}): Promise<Environment> {
    const payload = await this.transport.json<EnvironmentPayload>({
      method: "POST",
      path: ApiPath.environments(this.project),
      body: { id: name },
      ...options,
    });
    return { id: payload.id, name: payload.name };
  }
}
