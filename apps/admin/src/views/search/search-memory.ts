import type { MediaAsset } from '../../api/types/media-asset'
import type { SearchHit } from '../../api/types/search-hit'

export interface SearchState {
  text: string
  chip: string | null
  hits: SearchHit[]
  assets: MediaAsset[]
  engine: 'fts5' | 'scan' | null
  truncated: boolean
  error: string
}

/**
 * In-memory search state per scope (serverId, project, env).
 * Retains typed query, chosen collection chip, and search results
 * when clicking away or navigating between views within the same scope.
 */
export class SearchMemory {
  private static store = new Map<string, SearchState>()

  private static key(serverId: string, project: string, env: string): string {
    return `${serverId}:${project}:${env}`
  }

  static get(serverId: string, project: string, env: string): SearchState | null {
    return SearchMemory.store.get(SearchMemory.key(serverId, project, env)) ?? null
  }

  static set(serverId: string, project: string, env: string, state: SearchState): void {
    SearchMemory.store.set(SearchMemory.key(serverId, project, env), state)
  }

  static clear(serverId: string, project: string, env: string): void {
    SearchMemory.store.delete(SearchMemory.key(serverId, project, env))
  }
}
