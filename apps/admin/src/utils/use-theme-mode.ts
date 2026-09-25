import { useEffect, useState } from 'react'
import { ThemeManager, type ThemeMode } from './theme-manager'

export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() => ThemeManager.getSettings().mode)

  useEffect(() => {
    return ThemeManager.subscribe((settings) => {
      setMode(settings.mode)
    })
  }, [])

  return mode
}
