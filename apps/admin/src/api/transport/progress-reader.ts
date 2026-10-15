import { ApiError } from '../api-error'
import type { ImportResult } from '../types/import-result'

/** One line of a transfer's progress stream. */
export interface TransferProgress {
  phase: string
  /** Absent on a bare heartbeat, which carries no counters of its own. */
  result?: ImportResult
}

/**
 * Reads a transfer's line-delimited progress response (§7.8).
 *
 * The status went out before the work began, so it cannot carry the outcome:
 * the answer is the last line, and an `error` line becomes the same `ApiError`
 * an ordinary failed response would have produced. Each progress line reaches
 * `onProgress` whole, less its `type`: an import's carries its counters, a
 * prepared transfer's names the transfer (D109).
 */
export class ProgressReader {
  static readonly ContentType = 'application/x-ndjson'

  static async read<Result = ImportResult, Progress extends { phase: string } = TransferProgress>(
    response: Response,
    onProgress?: (progress: Progress) => void,
  ): Promise<Result> {
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError(502, 'invalid_response', 'the server sent no progress stream')

    const decoder = new TextDecoder()
    let buffered = ''
    let result: Result | null = null

    const take = (line: string) => {
      if (!line) return
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        // A partial line cannot happen here (they are split on newlines) and a
        // malformed one is not worth failing a finished import over.
        return
      }
      if (parsed.type === 'result') result = parsed.result as Result
      else if (parsed.type === 'error') {
        throw new ApiError(
          parsed.status || 500,
          parsed.error?.code || 'error',
          parsed.error?.message || 'transfer failed',
        )
      } else {
        const { type: _type, ...progress } = parsed
        onProgress?.(progress as Progress)
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) take(line)
    }
    take(buffered)

    if (!result) {
      // The stream ended without an answer, which means the connection died
      // mid-run. The destination's state is unknown, and saying so is the only
      // honest thing left.
      throw new ApiError(
        502,
        'incomplete',
        'the connection ended before the transfer reported a result; re-check the destination before retrying',
      )
    }
    return result
  }
}
