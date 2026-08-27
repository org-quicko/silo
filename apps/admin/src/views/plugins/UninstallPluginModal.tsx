import { useState } from 'react'
import { api } from '../../api/silo-api'
import { DangerConfirm } from '../../components/modal/DangerConfirm'
import type { PluginUninstallResponse } from '../../api/types/plugin-uninstall'
import type { PluginView } from '../../api/types/plugin-view'

/**
 * Uninstall, behind a typed name (D43).
 *
 * `DangerConfirm` rather than a plain confirmation, on the same rule projects
 * and environments are held to: reserved for actions no undo exists for. This
 * one qualifies twice over — the package leaves the disk, and the grant leaves
 * with it, so re-installing gives a plugin that has to be approved again from
 * nothing. The copy says so, because "are you sure" tells an operator only that
 * somebody thought this was serious.
 */
export function UninstallPluginModal({
  plugin,
  url,
  apiKey,
  onCancel,
  onDone,
}: {
  plugin: PluginView
  url: string
  apiKey: string
  onCancel: () => void
  onDone: (outcome: PluginUninstallResponse) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const uninstall = async () => {
    setBusy(true)
    setError('')
    try {
      onDone(await api.plugins.uninstall(url, apiKey, plugin.name, plugin.rev))
    } catch (caught: any) {
      setError(caught?.message || 'The plugin could not be uninstalled.')
      setBusy(false)
    }
  }

  return (
    <DangerConfirm
      title="Uninstall this plugin?"
      confirmWord={plugin.name}
      confirmLabel="Uninstall"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={uninstall}
    >
      Its <code>[[plugins]]</code> entry comes out of <code>silo.toml</code>, its worker stops, its
      managed key is destroyed and the package is deleted from disk.{' '}
      {plugin.granted.length > 0 ? (
        <>
          The {plugin.granted.length} permission{plugin.granted.length === 1 ? '' : 's'} you
          approved go with it. Installing this package again starts it approved for nothing.
        </>
      ) : (
        <>Installing this package again starts it approved for nothing.</>
      )}{' '}
      Entries it created stay where they are; only the plugin goes.
    </DangerConfirm>
  )
}
