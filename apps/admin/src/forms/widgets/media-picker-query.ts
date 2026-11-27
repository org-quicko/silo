import type { MediaQuery } from '../../api/types/media-query'

export interface MediaPickerTypeOption {
  value: string
  label: string
}

export interface MediaPickerState {
  search: string
  folder: string
  type: string
  page: number
  pageSize: number
}

/**
 * Pure pagination and filter state transitions for the media picker dialog.
 *
 * Keeps filter changes resetting back to page 1 and translates folder and
 * MIME prefix selections into the `MediaQuery` shape the server API accepts.
 */
export class MediaPickerQuery {
  static readonly DefaultPageSize = 24
  static readonly PageSizeOptions = [24, 48, 96]

  static readonly TypeOptions: readonly MediaPickerTypeOption[] = [
    { value: '', label: 'All types' },
    { value: 'image/', label: 'Images' },
    { value: 'video/', label: 'Video' },
    { value: 'audio/', label: 'Audio' },
    { value: 'application/pdf', label: 'PDF' },
    { value: 'text/', label: 'Text' },
  ]

  static initial(): MediaPickerState {
    return {
      search: '',
      folder: '',
      type: '',
      page: 1,
      pageSize: MediaPickerQuery.DefaultPageSize,
    }
  }

  static withSearch(state: MediaPickerState, search: string): MediaPickerState {
    return { ...state, search, page: 1 }
  }

  static withFolder(state: MediaPickerState, folder: string): MediaPickerState {
    return { ...state, folder, page: 1 }
  }

  static withType(state: MediaPickerState, type: string): MediaPickerState {
    return { ...state, type, page: 1 }
  }

  static withPage(state: MediaPickerState, page: number): MediaPickerState {
    const normalized = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
    return { ...state, page: normalized }
  }

  static withPageSize(state: MediaPickerState, pageSize: number): MediaPickerState {
    const normalized =
      Number.isFinite(pageSize) && pageSize > 0
        ? Math.floor(pageSize)
        : MediaPickerQuery.DefaultPageSize
    return { ...state, pageSize: normalized, page: 1 }
  }

  static clampPage(state: MediaPickerState, total: number): MediaPickerState {
    if (total <= 0) return state.page === 1 ? state : { ...state, page: 1 }
    const lastPage = Math.max(1, Math.ceil(total / state.pageSize))
    return state.page > lastPage ? { ...state, page: lastPage } : state
  }

  static toApiQuery(state: MediaPickerState): MediaQuery {
    const trimmedSearch = state.search.trim()
    return {
      q: trimmedSearch || undefined,
      folder: state.folder || undefined,
      recursive: state.folder === '',
      type: state.type || undefined,
      limit: state.pageSize,
      offset: (state.page - 1) * state.pageSize,
    }
  }

  static uploadFolder(state: MediaPickerState): string | undefined {
    return state.folder || undefined
  }

  static hasActiveFilters(state: MediaPickerState): boolean {
    return Boolean(state.search.trim() || state.folder || state.type)
  }
}
