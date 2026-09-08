import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'

/** What an export would carry, counted across the whole instance. */
export interface ArchiveContents
 {
  collections: string[]
  entries: number
  media: number
}

/**
 * What the archive on the Export tab actually contains.
 *
 * Counted by walking projects → environments → collections rather than read
 * off one number, because an export is **instance-wide** and every listing
 * silo has is scoped. The page used to show the current environment's
 * collection count under the words "what the archive contains", which is the
 * wrong number on any instance with a second environment.
 *
 * There is no manifest route to ask instead, so this is one request per scope.
 * It runs only while the Export tab is open, and reports what it has if a
 * scope refuses — a key that cannot read one project should not blank the
 * whole panel.
 */
export function useArchiveContents(url: string, apiKey: string, enabled: boolean) {
  const [contents, setContents] = useState<ArchiveContents | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const gather = async () => {
      const collections: string[] = []
      let entries = 0

      const projects = await api.projects.list(url, apiKey)
      for (const project of projects) {
        const environments = await api.projects
          .listEnvironments(url, apiKey, project.name)
          .catch(() => [])
        for (const env of environments) {
          const scoped = await api.collections
            .list(url, apiKey, { project: project.name, env: env.name })
            .catch(() => [])
          for (const collection of scoped) {
            if (!collections.includes(collection.name)) collections.push(collection.name)
            entries += collection.entries
          }
        }
      }

      // One library for the whole instance, so this one is a single request —
      // and `limit: 1` because only the total is wanted.
      const media = await api.media
        .list(url, apiKey, { limit: 1, recursive: true })
        .then((page) => page.total)
        .catch(() => 0)

      if (alive) setContents({ collections, entries, media })
    }

    gather().catch(() => alive && setContents(null))
    return () => {
      alive = false
    }
  }, [url, apiKey, enabled])

  return contents
}
