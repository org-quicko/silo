/** One recorded call to the fake `ctx.fetch`. */
export interface FakeSiloCall {
  path: string
  init: any
}

/**
 * A `ctx` that is only ever asked for `fetch`, which is all `MediaLibrary` uses
 * — so the fake is the whole surface rather than a stub of it.
 */
export class FakeSilo {
  static context(answer: (path: string, init: any) => any): {
    ctx: any
    calls: FakeSiloCall[]
  } {
    const calls: FakeSiloCall[] = []
    const ctx = {
      fetch: async (path: string, init: any) => {
        calls.push({ path, init })
        return answer(path, init)
      },
    } as any
    return { ctx, calls }
  }

  /** One `SiloResponse`, whose `json()` and `text()` are synchronous exactly as
   *  the real one's are. */
  static answer(status: number, body: unknown) {
    const text = JSON.stringify(body)
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {},
      bytes: new TextEncoder().encode(text),
      text: () => text,
      json: () => body,
    }
  }

  /** An `UploadStore` holding exactly these bytes for every name, or none. */
  static uploads(bytes: Uint8Array | null): any {
    return { read: async () => bytes }
  }

  /** The methods of every recorded call, which is what most of these tests
   *  assert: how many requests one import cost. */
  static methods(calls: readonly FakeSiloCall[]): string[] {
    return calls.map((call) => call.init?.method ?? 'GET')
  }
}
