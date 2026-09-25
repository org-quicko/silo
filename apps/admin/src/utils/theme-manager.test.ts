import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ThemeManager } from './theme-manager'

describe('ThemeManager', () => {
  let store: Record<string, string>
  let attrs: Record<string, string>
  let styles: Record<string, string>

  beforeEach(() => {
    store = {}
    attrs = {}
    styles = {}

    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        store = {}
      },
    }

    ;(globalThis as any).document = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          attrs[k] = v
        },
        getAttribute: (k: string) => attrs[k] ?? null,
        removeAttribute: (k: string) => {
          delete attrs[k]
        },
        style: {
          setProperty: (k: string, v: string) => {
            styles[k] = v
          },
          getPropertyValue: (k: string) => styles[k] ?? '',
          colorScheme: '',
        },
      },
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ id: '', rel: '', href: '' }),
      head: { appendChild: () => {} },
    }
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).document
  })

  test('default settings start in dark mode with Silo defaults', () => {
    const settings = ThemeManager.getSettings()
    expect(settings.mode).toBe('dark')
    expect(settings.font).toBe(ThemeManager.DEFAULT_FONT)
    expect(settings.theme).toBe(ThemeManager.DEFAULT_THEME)
    expect(settings.accent).toBe(ThemeManager.DEFAULT_ACCENT)
  })

  test('setMode updates settings and persists to storage', () => {
    ThemeManager.setMode('light')
    expect(ThemeManager.getSettings().mode).toBe('light')

    const raw = (globalThis as any).localStorage.getItem('silo_appearance_settings')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).mode).toBe('light')

    ThemeManager.setMode('dark')
    expect(ThemeManager.getSettings().mode).toBe('dark')
  })

  test('switching to light mode applies data-theme and parchment light sidebar', () => {
    ThemeManager.setMode('light')
    expect(attrs['data-theme']).toBe('light')
    expect(styles['--sidebar']).toBe('#fcfbf8')
    expect(styles['--sidebar-hover']).toBe('#f0ece3')
  })

  test('switching to dark mode applies dark data-theme and dark sidebar', () => {
    ThemeManager.setMode('light')
    ThemeManager.setMode('dark')
    expect(attrs['data-theme']).toBe('dark')
    expect(styles['--sidebar']).toBe(ThemeManager.DEFAULT_SIDEBAR)
  })

  test('mode switch maps dark preset to curated light preset and vice-versa', () => {
    ThemeManager.setTheme('Emerald')
    ThemeManager.setMode('light')
    expect(ThemeManager.getSettings().theme).toBe('Forest Cypress')
    expect(styles['--sidebar']).toBe('#fcfbf8')

    ThemeManager.setMode('dark')
    expect(ThemeManager.getSettings().theme).toBe('Emerald')
    expect(styles['--sidebar']).toBe('#0f1f1a')
  })

  test('getPresets returns curated presets based on mode', () => {
    const darkPresets = ThemeManager.getPresets('dark')
    expect(darkPresets).toEqual(ThemeManager.DARK_PRESETS)
    expect(darkPresets.some((p) => p.name === 'Silo Indigo')).toBe(true)

    const lightPresets = ThemeManager.getPresets('light')
    expect(lightPresets).toEqual(ThemeManager.LIGHT_PRESETS)
    expect(lightPresets.some((p) => p.name === 'Prussian Blue')).toBe(true)
    expect(lightPresets.some((p) => p.name === 'Forest Cypress')).toBe(true)
  })

  test('reset restores default mode and appearance', () => {
    ThemeManager.setMode('light')
    ThemeManager.setTheme('Violet')
    ThemeManager.setFont('Inter')

    const defaults = ThemeManager.reset()
    expect(defaults.mode).toBe('dark')
    expect(defaults.theme).toBe(ThemeManager.DEFAULT_THEME)
    expect(defaults.font).toBe(ThemeManager.DEFAULT_FONT)
    expect(attrs['data-theme']).toBe('dark')
  })

  test('subscribe notifies listeners on mode and theme changes', () => {
    const received: string[] = []
    const unsubscribe = ThemeManager.subscribe((settings) => {
      received.push(`${settings.theme}:${settings.mode}`)
    })

    ThemeManager.setMode('light')
    ThemeManager.setTheme('Imperial Plum')
    unsubscribe()

    ThemeManager.setMode('dark')
    expect(received).toEqual([
      'Prussian Blue:light',
      'Imperial Plum:light',
    ])
  })

  test('malformed localStorage falls back cleanly', () => {
    store['silo_appearance_settings'] = '{not valid json'
    const settings = ThemeManager.getSettings()
    expect(settings.mode).toBe('dark')
    expect(settings.theme).toBe(ThemeManager.DEFAULT_THEME)
  })
})
