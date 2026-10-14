import { describe, expect, test } from 'bun:test'
import { ApiError } from '../api-error'
import { ProgressReader } from './progress-reader'

/** A progress response delivered in the given chunks, which need not end on a line. */
const stream = (...chunks: string[]) => {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }))
}

describe('ProgressReader', () => {
  test('hands each progress line over whole, so a preparation can be cancelled by the id its first line names', async () => {
    const seen: unknown[] = []
    const result = await ProgressReader.read<{ id: string; state: string }, { phase: string }>(
      stream(
        '{"type":"progress","phase":"fetch","transfer":{"id":"01T","state":"preparing"}}\n{"type":"prog',
        'ress","phase":"working"}\n{"type":"result","result":{"id":"01T","state":"prepared"}}\n',
      ),
      (progress) => seen.push(progress),
    )
    expect(seen).toEqual([{ phase: 'fetch', transfer: { id: '01T', state: 'preparing' } }, { phase: 'working' }])
    expect(result).toEqual({ id: '01T', state: 'prepared' })
  })

  test('an error line keeps its code, which is how a stale preview is told from other failures', async () => {
    const failure = await ProgressReader.read(
      stream('{"type":"progress","phase":"media","transfer":{"id":"01T"}}\n', '{"type":"error","status":409,"error":{"code":"stale_preview","message":"this server changed"}}\n'),
    ).catch((caught: unknown) => caught)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).code).toBe('stale_preview')
  })
})
