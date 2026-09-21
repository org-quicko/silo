import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { TransferTree } from './transfer-tree'

/**
 * What an instance-wide transfer could carry.
 *
 * One request per scope, because a transfer covers every project and
 * environment while every listing silo has is scoped, and there is no manifest
 * route to ask instead. It runs only while a tab that needs it is open, and
 * reports what it has if a scope refuses: a key that cannot read one project
 * should not blank the whole panel, so `partial` says the totals are a floor.
 */
export function useTransferTree(url: string, apiKey: string, enabled: boolean): TransferTree | null {
  const [tree, setTree] = useState<TransferTree | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const gather = async (): Promise<TransferTree> => {
      const out: TransferTree = { projects: [], media: 0, partial: false }
      const refused = () => {
        out.partial = true
        return []
      }

      for (const project of await api.projects.list(url, apiKey)) {
        const environments = await api.projects
          .listEnvironments(url, apiKey, project.name)
          .catch(refused)
        const envs = []
        for (const env of environments) {
          const scoped = await api.collections
            .list(url, apiKey, { project: project.name, env: env.name })
            .catch(refused)
          envs.push({
            name: env.name,
            collections: scoped.map((collection) => ({
              name: collection.name,
              entries: collection.entries,
            })),
          })
        }
        out.projects.push({ name: project.name, envs })
      }

      // One library for the whole instance, so this one is a single request,
      // with `limit: 1` because only the total is wanted.
      out.media = await api.media
        .list(url, apiKey, { limit: 1, recursive: true })
        .then((page) => page.total)
        .catch(() => {
          out.partial = true
          return 0
        })

      return out
    }

    gather()
      .then((next) => alive && setTree(next))
      .catch(() => alive && setTree(null))
    return () => {
      alive = false
    }
  }, [url, apiKey, enabled])

  return tree
}
