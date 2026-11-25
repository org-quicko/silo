import { useCallback, useSyncExternalStore } from 'react'
import { ThemeManager, type ThemeMode, type ThemeSettings } from './theme-manager'

export function useThemeSettings(serverId?: string | null): ThemeSettings {
  const subscribe = useCallback(
    (onStoreChange: () => void) => ThemeManager.subscribe(() => onStoreChange()),
    [],
  )
  const getSnapshot = () => ThemeManager.getSettings(serverId)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useThemeMode(serverId?: string | null): ThemeMode {
  return useThemeSettings(serverId).mode
}
