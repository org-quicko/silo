import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import type { MediaFolderDeleteOptions } from "./media-folder-delete.js";
import type { MediaFolderMoveOptions } from "./media-folder-move.js";

/** The media library's folder tree: `list`, `create`, `rename`/move,
 * `delete`. A folder is an explicit record, so one can exist before
 * anything is filed into it. */
export class MediaFolders {
  constructor(private readonly transport: Transport) {}

  async list(options?: RequestOptions): Promise<string[]> {
    const body = await this.transport.json<{ items: string[] }>({
      method: "GET",
      path: ApiPath.mediaFolders(),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return body.items;
  }

  /** Answers the path the server settled on. */
  async create(path: string, options?: RequestOptions): Promise<string> {
    const body = await this.transport.json<{ path: string }>({
      method: "POST",
      path: ApiPath.mediaFolders(),
      body: { path },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
    return body.path;
  }

  rename(from: string, to: string, options?: MediaFolderMoveOptions): Promise<{ from: string; to: string }> {
    return this.transport.json({
      method: "PATCH",
      path: ApiPath.mediaFolders(),
      body: { from, to, merge: options?.merge === true },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /** The folder path is carried as `?path=`, not a path segment — it
   * contains "/". `force` needs `recursive`: without it nothing here
   * deletes anything, so there is nothing to force. */
  async delete(path: string, options?: MediaFolderDeleteOptions): Promise<void> {
    await this.transport.empty({
      method: "DELETE",
      path: ApiPath.mediaFolders(),
      query: {
        path,
        ...(options?.recursive ? { recursive: true } : {}),
        ...(options?.force ? { force: true } : {}),
      },
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }
}
