import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ThemeManager } from './theme-manager'

describe('ThemeManager', () => {
  let store: Record<string, string>
  let attrs: Record<string, string>
  let styles: Record<string, string>
  let windowListeners: Map<string, Set<(event: any) => void>>
  let setItemError: Error | null
  let removeItemError: Error | null

  beforeEach(() => {
    store = {}
    attrs = {}
    styles = {}
    windowListeners = new Map()
    setItemError = null
    removeItemError = null

    ;(globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (setItemError) throw setItemError
        store[k] = v
      },
      removeItem: (k: string) => {
        if (removeItemError) throw removeItemError
        delete store[k]
      },
      clear: () => {
        store = {}
      },
    }

    ;(globalThis as any).window = {
      addEventListener: (type: string, listener: (event: any) => void) => {
        const set = windowListeners.get(type) ?? new Set()
        set.add(listener)
        windowListeners.set(type, set)
      },
      removeEventListener: (type: string, listener: (event: any) => void) => {
        windowListeners.get(type)?.delete(listener)
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

    ThemeManager.init('s1')
  })

  afterEach(() => {
    ThemeManager.setActiveServer(null)
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
    delete (globalThis as any).document
  })

  test('default settings start in dark mode with Silo defaults', () => {
    const settings = ThemeManager.getSettings('s1')
    expect(settings.mode).toBe('dark')
    expect(settings.font).toBe(ThemeManager.DEFAULT_FONT)
    expect(settings.theme).toBe(ThemeManager.DEFAULT_THEME)
    expect(settings.accent).toBe(ThemeManager.DEFAULT_ACCENT)
    expect(ThemeManager.getSettings('s1')).toBe(settings)
  })

  test('setMode updates active server settings and persists under its own key', () => {
    expect(ThemeManager.setMode('light')).toBe(true)
    expect(ThemeManager.getSettings().mode).toBe('light')
    expect(ThemeManager.getSettings('s2').mode).toBe('dark')

    const raw = (globalThis as any).localStorage.getItem(ThemeManager.storageKey('s1'))
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).mode).toBe('light')
    expect((globalThis as any).localStorage.getItem(ThemeManager.storageKey('s2'))).toBeNull()

    ThemeManager.setMode('dark')
    expect(ThemeManager.getSettings().mode).toBe('dark')
  })

  test('settings are isolated per server and switching active server repaints the document', () => {
    ThemeManager.setMode('light', 's1')
    ThemeManager.setTheme('Burnt Terracotta', 's1')
    ThemeManager.setFont('Lora', 's1')

    ThemeManager.setTheme('Emerald', 's2')
    ThemeManager.setFont('Inter', 's2')

    // Updating a non-active server does not overwrite the active DOM.
    expect(attrs['data-theme']).toBe('light')
    expect(styles['--accent']).toBe('#a84b2c')
    expect(styles['--font-ui']).toContain("'Lora'")

    // Switching active server repaints the document with that server's settings.
    ThemeManager.setActiveServer('s2')
    expect(ThemeManager.getActiveServerId()).toBe('s2')
    expect(attrs['data-theme']).toBe('dark')
    expect(styles['--accent']).toBe('#00a86b')
    expect(styles['--sidebar']).toBe('#0f1f1a')
    expect(styles['--font-ui']).toContain("'Inter'")

    // Returning to A and then leaving all servers restores defaults on the DOM.
    ThemeManager.setActiveServer('s1')
    expect(attrs['data-theme']).toBe('light')
    expect(styles['--accent']).toBe('#a84b2c')

    ThemeManager.setActiveServer(null)
    expect(attrs['data-theme']).toBe('dark')
    expect(styles['--accent']).toBe(ThemeManager.DEFAULT_ACCENT)
    expect(styles['--font-ui']).toContain(`'${ThemeManager.DEFAULT_FONT}'`)
  })

  test('mutating without an active server or explicit serverId is a no-op', () => {
    ThemeManager.setActiveServer(null)
    ThemeManager.setMode('light')
    ThemeManager.setTheme('Violet')
    ThemeManager.setFont('Inter')
    expect(Object.keys(store)).toEqual([])
  })

  test('setFont keeps a typed name inside the family parameter of the font URL', () => {
    const appended: { href: string }[] = []
    ;(globalThis as any).document.head.appendChild = (node: { href: string }) => appended.push(node)

    ThemeManager.setFont('Noto Sans & More#1')

    const url = new URL(appended[0].href)
    expect(url.origin).toBe('https://fonts.googleapis.com')
    expect(url.searchParams.getAll('family')).toEqual(['Noto Sans & More#1:wght@300;400;500;600;700'])
    expect(url.searchParams.get('display')).toBe('swap')
    expect(url.hash).toBe('')
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

  test('reset restores default mode and appearance for that server only', () => {
    ThemeManager.setMode('light', 's1')
    ThemeManager.setTheme('Imperial Plum', 's1')
    ThemeManager.setFont('Inter', 's1')

    ThemeManager.setTheme('Emerald', 's2')

    const defaults = ThemeManager.reset('s1')
    expect(defaults.mode).toBe('dark')
    expect(defaults.theme).toBe(ThemeManager.DEFAULT_THEME)
    expect(defaults.font).toBe(ThemeManager.DEFAULT_FONT)
    expect(attrs['data-theme']).toBe('dark')
    expect(ThemeManager.getSettings('s2').theme).toBe('Emerald')
  })

  test('forget removes one server without affecting others and resets DOM if active', () => {
    ThemeManager.setMode('light', 's1')
    ThemeManager.setTheme('Emerald', 's2')

    ThemeManager.forget('s1')
    expect(ThemeManager.getSettings('s1').mode).toBe('dark')
    expect(attrs['data-theme']).toBe('dark')
    expect(ThemeManager.getSettings('s2').theme).toBe('Emerald')
  })

  test('subscribe notifies listeners on mode, theme, and active server changes', () => {
    const received: string[] = []
    const unsubscribe = ThemeManager.subscribe((settings, serverId) => {
      received.push(`${serverId}:${settings.theme}:${settings.mode}`)
    })

    ThemeManager.setMode('light')
    ThemeManager.setTheme('Imperial Plum')
    ThemeManager.setActiveServer('s2')
    unsubscribe()

    ThemeManager.setMode('dark')
    expect(received).toEqual([
      's1:Prussian Blue:light',
      's1:Imperial Plum:light',
      's2:Silo Indigo:dark',
    ])
  })

  test('migrates legacy app-wide settings once to existing servers and ignores later legacy writes', () => {
    store['silo_appearance_settings'] = JSON.stringify({
      font: 'Inter',
      accent: '#216e4e',
      theme: 'Forest Cypress',
      sidebar: '#fcfbf8',
      sidebarHover: '#f0ece3',
      mode: 'light',
    })
    store[ThemeManager.storageKey('s2')] = JSON.stringify({
      font: 'Lora',
      accent: '#bf5af2',
      theme: 'Violet',
      sidebar: '#1d1630',
      sidebarHover: '#2a2040',
      mode: 'dark',
    })

    ThemeManager.init('s1', ['s1', 's2'])

    // Existing unconfigured server inherits the legacy theme once.
    expect(ThemeManager.getSettings('s1').mode).toBe('light')
    expect(ThemeManager.getSettings('s1').theme).toBe('Forest Cypress')
    expect(ThemeManager.getSettings('s1').font).toBe('Inter')
    expect(attrs['data-theme']).toBe('light')

    // Server with an existing per-server entry is preserved.
    expect(ThemeManager.getSettings('s2').theme).toBe('Violet')
    expect(ThemeManager.getSettings('s2').mode).toBe('dark')

    // Legacy key is cleared so newly added servers start at defaults.
    expect(store['silo_appearance_settings']).toBeUndefined()
    expect(ThemeManager.getSettings('s3').mode).toBe('dark')
    expect(ThemeManager.getSettings('s3').theme).toBe(ThemeManager.DEFAULT_THEME)

    // Even if an older tab writes back to the legacy key, per-server keys are unaffected.
    store['silo_appearance_settings'] = JSON.stringify({ mode: 'dark', theme: 'Violet' })
    expect(ThemeManager.getSettings('s1').mode).toBe('light')
  })

  test('failed storage writes keep DOM, snapshot, and toggle state consistent', () => {
    setItemError = new Error('QuotaExceededError')

    expect(ThemeManager.setMode('light', 's1')).toBe(false)
    expect(attrs['data-theme']).toBe('light')
    expect(ThemeManager.getSettings('s1').mode).toBe('light')

    // Toggling back reads the authoritative in-memory snapshot and succeeds cleanly.
    expect(ThemeManager.setMode('dark', 's1')).toBe(false)
    expect(attrs['data-theme']).toBe('dark')
    expect(ThemeManager.getSettings('s1').mode).toBe('dark')

    // Reset when removeItem fails also keeps snapshot and DOM on defaults.
    ThemeManager.setTheme('Emerald', 's1')
    removeItemError = new Error('StorageBlocked')
    const defaults = ThemeManager.reset('s1')
    expect(ThemeManager.isLastWritePersisted()).toBe(false)
    expect(defaults.theme).toBe(ThemeManager.DEFAULT_THEME)
    expect(ThemeManager.getSettings('s1').theme).toBe(ThemeManager.DEFAULT_THEME)
  })

  test('cross-tab storage events update active DOM and subscribers without clobbering other servers', () => {
    const events: string[] = []
    const unsubscribe = ThemeManager.subscribe((settings, serverId) => {
      events.push(`${serverId}:${settings.theme}:${settings.mode}`)
    })

    // Another tab updates the active server s1.
    store[ThemeManager.storageKey('s1')] = JSON.stringify({
      font: 'Space Grotesk',
      accent: '#216e4e',
      theme: 'Forest Cypress',
      sidebar: '#fcfbf8',
      sidebarHover: '#f0ece3',
      mode: 'light',
    })
    for (const listener of windowListeners.get('storage') ?? []) {
      listener({ key: ThemeManager.storageKey('s1') })
    }

    expect(attrs['data-theme']).toBe('light')
    expect(styles['--accent']).toBe('#216e4e')
    expect(styles['--font-ui']).toContain("'Space Grotesk'")
    expect(ThemeManager.getSettings('s1').mode).toBe('light')

    // Another tab updates non-active server s2: DOM stays on s1, subscribers receive s2 update.
    store[ThemeManager.storageKey('s2')] = JSON.stringify({
      font: 'Inter',
      accent: '#f43f5e',
      theme: 'Rose Pink',
      sidebar: '#26121a',
      sidebarHover: '#351b26',
      mode: 'dark',
    })
    for (const listener of windowListeners.get('storage') ?? []) {
      listener({ key: ThemeManager.storageKey('s2') })
    }

    expect(attrs['data-theme']).toBe('light')
    expect(events).toEqual([
      's1:Forest Cypress:light',
      's2:Rose Pink:dark',
    ])

    // Another tab clears storage (key === null): active server reverts to defaults.
    delete store[ThemeManager.storageKey('s1')]
    for (const listener of windowListeners.get('storage') ?? []) {
      listener({ key: null })
    }
    expect(attrs['data-theme']).toBe('dark')
    expect(ThemeManager.getSettings('s1').theme).toBe(ThemeManager.DEFAULT_THEME)

    unsubscribe()
  })

  test('malformed per-server storage falls back cleanly and hydrates partial light entries', () => {
    store[ThemeManager.storageKey('s1')] = '{not valid json'
    expect(ThemeManager.getSettings('s1').mode).toBe('dark')
    expect(ThemeManager.getSettings('s1').theme).toBe(ThemeManager.DEFAULT_THEME)

    store[ThemeManager.storageKey('s1')] = JSON.stringify({ mode: 'light' })
    const hydrated = ThemeManager.getSettings('s1')
    expect(hydrated.mode).toBe('light')
    expect(hydrated.theme).toBe('Prussian Blue')
    expect(hydrated.sidebar).toBe('#fcfbf8')
  })
})
