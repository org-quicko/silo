import { Claims } from '@silo/shared/claims'
import type { PrepareTransferOptions } from '../../../api/types/prepare-transfer-options'
import type { ScopeRef } from '../../../api/types/scope-ref'
import type { Server } from '../../servers/server'
import { useCopySource } from './use-copy-source'
import { useRemoteTransfer } from './use-remote-transfer'
import { useScopeCopy } from './use-scope-copy'

/**
 * The env copy form read as a transfer from another server (D112): what to
 * prepare, which claims a transfer asks beyond an env copy, and the transfer.
 */
export function useRemoteCopy(
  server: Server,
  destination: ScopeRef,
  claims: string[],
  source: ReturnType<typeof useCopySource>,
  copy: ReturnType<typeof useScopeCopy>,
) {
  const options: PrepareTransferOptions | null =
    source.remote && source.endpoint && copy.from
      ? {
          sourceUrl: source.endpoint.url,
          sourceApiKey: source.endpoint.apiKey,
          from: copy.from,
          // A transfer names what it carries, so everything is every collection.
          selection: copy.customize ? copy.selection : copy.collections.map((item) => ({ collection: item.name })),
          mode: copy.mode,
          prefer: copy.prefer,
          media: source.media,
        }
      : null
  const remote = useRemoteTransfer(server, destination, options)

  // Reach outside this server, write media here, and package the source.
  const missing = !source.remote
    ? []
    : [
        { holder: 'This key', claim: Claims.TransferCopy, held: Claims.has(claims, Claims.TransferCopy) },
        { holder: 'This key', claim: Claims.MediaCreate, held: source.media === 'none' || Claims.has(claims, Claims.MediaCreate) },
        {
          holder: 'The source key',
          claim: Claims.TransferExport,
          held: source.status !== 'ready' || Claims.has(source.claims ?? [], Claims.TransferExport),
        },
      ].filter((item) => !item.held)

  return {
    ...remote,
    missing,
    /** The form names something this key and the source key may copy. */
    ready: !!options && options.selection.length > 0 && copy.allowed && copy.selectionValid && missing.length === 0,
  }
}
