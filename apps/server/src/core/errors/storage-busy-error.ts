/** Too many reads are already waiting on storage: HTTP 503, try again shortly. */
export class StorageBusyError extends Error {
  constructor(message: string = "storage is busy; retry shortly") {
    super(message);
    this.name = "StorageBusyError";
  }
}
