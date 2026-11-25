export type ThemeMode = 'dark' | 'light'

export interface ThemeSettings {
  font: string
  accent: string
  theme: string
  sidebar: string
  sidebarHover: string
  mode: ThemeMode
}

export interface FontPreset {
  name: string
  category: 'Sans-Serif' | 'Serif' | 'Display' | 'Monospace'
}

/** A theme bundles an accent with the sidebar tint it was designed alongside,
 *  so picking one visibly retints the sidebar rather than only the accent. */
export interface ThemePreset {
  name: string
  description?: string
  accent: string
  sidebar: string
  sidebarHover: string
}

type ThemeListener = (settings: ThemeSettings, serverId: string | null) => void

export class ThemeManager {
  private static readonly LEGACY_STORAGE_KEY = 'silo_appearance_settings'
  private static readonly STORAGE_PREFIX = 'silo_appearance_settings:'
  private static readonly LINK_ID = 'silo-google-font'
  private static readonly PRESETS_LINK_ID = 'silo-google-font-presets'

  public static readonly DEFAULT_FONT = 'Hanken Grotesk'
  public static readonly DEFAULT_ACCENT = '#7c86ff'
  public static readonly DEFAULT_THEME = 'Silo Indigo'
  public static readonly DEFAULT_MODE: ThemeMode = 'dark'
  public static readonly DEFAULT_SIDEBAR = '#14171f'
  public static readonly DEFAULT_SIDEBAR_HOVER = '#1c202a'

  public static readonly DEFAULT_LIGHT_THEME = 'Prussian Blue'
  public static readonly DEFAULT_LIGHT_ACCENT = '#24588a'
  public static readonly DEFAULT_LIGHT_SIDEBAR = '#f8fafd'
  public static readonly DEFAULT_LIGHT_SIDEBAR_HOVER = '#edf2f7'

  private static activeServerId: string | null = null
  private static listeners = new Set<ThemeListener>()
  private static snapshotCache = new Map<string, ThemeSettings>()
  private static memoryOverrides = new Map<string, ThemeSettings>()
  private static attachedWindow: EventTarget | null = null
  private static lastWritePersisted = true

  private static readonly DEFAULT_SNAPSHOT: ThemeSettings = Object.freeze({
    font: ThemeManager.DEFAULT_FONT,
    accent: ThemeManager.DEFAULT_ACCENT,
    theme: ThemeManager.DEFAULT_THEME,
    sidebar: ThemeManager.DEFAULT_SIDEBAR,
    sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER,
    mode: ThemeManager.DEFAULT_MODE,
  })

  public static readonly FONT_PRESETS: FontPreset[] = [
    { name: 'Hanken Grotesk', category: 'Sans-Serif' },
    { name: 'Inter', category: 'Sans-Serif' },
    { name: 'DM Sans', category: 'Sans-Serif' },
    { name: 'Space Grotesk', category: 'Sans-Serif' },
    { name: 'Nunito', category: 'Sans-Serif' },
    { name: 'Rubik', category: 'Sans-Serif' },
    { name: 'Lora', category: 'Serif' },
    { name: 'Fira Code', category: 'Monospace' },
  ]

  // Curated presets for Dark Mode: vibrant, luminescent accents on dark slate chrome.
  public static readonly DARK_PRESETS: ThemePreset[] = [
    { name: 'Silo Indigo', description: 'Default', accent: '#7c86ff', sidebar: '#14171f', sidebarHover: '#1c202a' },
    { name: 'Violet', accent: '#bf5af2', sidebar: '#1d1630', sidebarHover: '#2a2040' },
    { name: 'Sky Blue', accent: '#4c8df6', sidebar: '#101d2b', sidebarHover: '#19293b' },
    { name: 'Emerald', accent: '#00a86b', sidebar: '#0f1f1a', sidebarHover: '#172c25' },
    { name: 'Amber Gold', accent: '#f59e0b', sidebar: '#221a10', sidebarHover: '#302617' },
    { name: 'Rose Pink', accent: '#f43f5e', sidebar: '#26121a', sidebarHover: '#351b26' },
  ]

  // Curated presets for Light Mode: rich archival inks harmonized with the warm parchment palette.
  public static readonly LIGHT_PRESETS: ThemePreset[] = [
    { name: 'Prussian Blue', description: 'Default', accent: '#24588a', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
    { name: 'Forest Cypress', accent: '#216e4e', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
    { name: 'Burnt Terracotta', accent: '#a84b2c', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
    { name: 'Imperial Plum', accent: '#7b3868', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
    { name: 'Antique Brass', accent: '#96681e', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
    { name: 'Iron Ore', accent: '#3f4756', sidebar: '#fcfbf8', sidebarHover: '#f0ece3' },
  ]

  private static readonly PRESET_MAP_DARK_TO_LIGHT: Record<string, string> = {
    'Silo Indigo': 'Prussian Blue',
    'Violet': 'Imperial Plum',
    'Sky Blue': 'Prussian Blue',
    'Emerald': 'Forest Cypress',
    'Amber Gold': 'Antique Brass',
    'Rose Pink': 'Burnt Terracotta',
  }

  private static readonly PRESET_MAP_LIGHT_TO_DARK: Record<string, string> = {
    'Prussian Blue': 'Silo Indigo',
    'Forest Cypress': 'Emerald',
    'Burnt Terracotta': 'Rose Pink',
    'Imperial Plum': 'Violet',
    'Antique Brass': 'Amber Gold',
    'Iron Ore': 'Silo Indigo',
  }

  public static get THEME_PRESETS(): ThemePreset[] {
    return [...ThemeManager.DARK_PRESETS, ...ThemeManager.LIGHT_PRESETS]
  }

  public static storageKey(serverId: string): string {
    return `${ThemeManager.STORAGE_PREFIX}${serverId}`
  }

  public static getActiveServerId(): string | null {
    return ThemeManager.activeServerId
  }

  public static isLastWritePersisted(): boolean {
    return ThemeManager.lastWritePersisted
  }

  public static setActiveServer(serverId: string | null): void {
    const normalized = serverId || null
    const changed = ThemeManager.activeServerId !== normalized
    ThemeManager.activeServerId = normalized
    const settings = ThemeManager.getSettings(normalized)
    ThemeManager.applyFont(settings.font)
    ThemeManager.repaint(settings)
    if (changed) {
      ThemeManager.emit(settings, normalized)
    }
  }

  public static getPresets(mode?: ThemeMode, serverId?: string | null): ThemePreset[] {
    const activeMode = mode || ThemeManager.getSettings(serverId).mode
    return activeMode === 'light' ? ThemeManager.LIGHT_PRESETS : ThemeManager.DARK_PRESETS
  }

  public static getSettings(serverId?: string | null): ThemeSettings {
    const targetId = ThemeManager.resolveServerId(serverId)
    if (!targetId) return ThemeManager.DEFAULT_SNAPSHOT

    const override = ThemeManager.memoryOverrides.get(targetId)
    if (override) {
      return ThemeManager.cacheSnapshot(targetId, override)
    }

    const stored = ThemeManager.readServerEntry(targetId)
    return ThemeManager.cacheSnapshot(targetId, ThemeManager.sanitize(stored))
  }

  public static setFont(fontName: string, serverId?: string | null): boolean {
    const trimmed = fontName.trim() || ThemeManager.DEFAULT_FONT
    return ThemeManager.update(
      serverId,
      (current) => ({ ...current, font: trimmed }),
      { applyFont: true, repaint: false },
    )
  }

  public static setTheme(themeName: string, serverId?: string | null): boolean {
    const preset = ThemeManager.THEME_PRESETS.find((t) => t.name === themeName)
    if (!preset) return true
    return ThemeManager.update(
      serverId,
      (current) => ({
        ...current,
        theme: preset.name,
        accent: preset.accent,
        sidebar: preset.sidebar,
        sidebarHover: preset.sidebarHover,
      }),
      { applyFont: false, repaint: true },
    )
  }

  public static setAccent(colorHex: string, serverId?: string | null): boolean {
    const formatted = ThemeManager.formatHex(colorHex) || ThemeManager.DEFAULT_ACCENT
    return ThemeManager.update(
      serverId,
      (current) => ({ ...current, accent: formatted, theme: 'Custom' }),
      { applyFont: false, repaint: true },
    )
  }

  public static setMode(mode: ThemeMode, serverId?: string | null): boolean {
    return ThemeManager.update(
      serverId,
      (current) => {
        if (current.mode === mode) return null

        let nextTheme = current.theme
        let nextAccent = current.accent
        let nextSidebar = current.sidebar
        let nextSidebarHover = current.sidebarHover

        if (mode === 'light') {
          const targetName = ThemeManager.PRESET_MAP_DARK_TO_LIGHT[current.theme] || ThemeManager.DEFAULT_LIGHT_THEME
          const lightPreset = ThemeManager.LIGHT_PRESETS.find((p) => p.name === targetName) || ThemeManager.LIGHT_PRESETS[0]
          if (current.theme !== 'Custom') {
            nextTheme = lightPreset.name
            nextAccent = lightPreset.accent
            nextSidebar = lightPreset.sidebar
            nextSidebarHover = lightPreset.sidebarHover
          }
        } else {
          const targetName = ThemeManager.PRESET_MAP_LIGHT_TO_DARK[current.theme] || ThemeManager.DEFAULT_THEME
          const darkPreset = ThemeManager.DARK_PRESETS.find((p) => p.name === targetName) || ThemeManager.DARK_PRESETS[0]
          if (current.theme !== 'Custom') {
            nextTheme = darkPreset.name
            nextAccent = darkPreset.accent
            nextSidebar = darkPreset.sidebar
            nextSidebarHover = darkPreset.sidebarHover
          }
        }

        return {
          ...current,
          mode,
          theme: nextTheme,
          accent: nextAccent,
          sidebar: nextSidebar,
          sidebarHover: nextSidebarHover,
        }
      },
      { applyFont: false, repaint: true },
    )
  }

  public static reset(serverId?: string | null): ThemeSettings {
    const targetId = ThemeManager.resolveServerId(serverId)
    const defaults = ThemeManager.DEFAULT_SNAPSHOT
    if (!targetId) {
      ThemeManager.lastWritePersisted = true
      return defaults
    }

    const persisted = ThemeManager.removeServerEntry(targetId)
    ThemeManager.lastWritePersisted = persisted
    if (persisted) {
      ThemeManager.memoryOverrides.delete(targetId)
    } else {
      ThemeManager.memoryOverrides.set(targetId, defaults)
    }
    ThemeManager.snapshotCache.set(targetId, defaults)

    if (ThemeManager.activeServerId === targetId) {
      ThemeManager.applyFont(defaults.font)
      ThemeManager.repaint(defaults)
    }
    ThemeManager.emit(defaults, targetId)
    return defaults
  }

  public static forget(serverId: string): void {
    const hadOverride = ThemeManager.memoryOverrides.has(serverId)
    const hadStored = ThemeManager.hasStoredServerEntry(serverId)
    ThemeManager.memoryOverrides.delete(serverId)
    ThemeManager.snapshotCache.delete(serverId)

    if (!hadOverride && !hadStored) return

    if (!ThemeManager.removeServerEntry(serverId)) {
      ThemeManager.memoryOverrides.set(serverId, ThemeManager.DEFAULT_SNAPSHOT)
    }
    if (ThemeManager.activeServerId === serverId) {
      ThemeManager.applyFont(ThemeManager.DEFAULT_SNAPSHOT.font)
      ThemeManager.repaint(ThemeManager.DEFAULT_SNAPSHOT)
      ThemeManager.emit(ThemeManager.DEFAULT_SNAPSHOT, serverId)
    }
  }

  public static subscribe(listener: ThemeListener): () => void {
    ThemeManager.listeners.add(listener)
    return () => ThemeManager.listeners.delete(listener)
  }

  private static emit(settings: ThemeSettings, serverId: string | null): void {
    for (const listener of ThemeManager.listeners) {
      try {
        listener(settings, serverId)
      } catch {
        /* ignore listener failure */
      }
    }
  }

  /**
   * Seeds existing saved servers once from the legacy app-wide key, then removes
   * that key so future connections start on defaults and older tabs cannot overwrite
   * per-server entries.
   */
  public static migrateLegacy(serverIds: readonly string[]): void {
    try {
      const raw = localStorage.getItem(ThemeManager.LEGACY_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (ThemeManager.isLegacyFlatSettings(parsed)) {
        const legacy = ThemeManager.sanitize(parsed)
        const serialized = JSON.stringify(legacy)
        const seen = new Set<string>()
        for (const id of serverIds) {
          if (!id || seen.has(id)) continue
          seen.add(id)
          const key = ThemeManager.storageKey(id)
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, serialized)
            ThemeManager.snapshotCache.delete(id)
          }
        }
      }
      localStorage.removeItem(ThemeManager.LEGACY_STORAGE_KEY)
    } catch {
      /* ignore malformed legacy data or blocked storage */
    }
  }

  public static init(serverId: string | null = null, knownServerIds: readonly string[] = []): void {
    ThemeManager.snapshotCache.clear()
    ThemeManager.memoryOverrides.clear()
    ThemeManager.lastWritePersisted = true
    ThemeManager.activeServerId = serverId || null
    ThemeManager.migrateLegacy(knownServerIds)
    ThemeManager.attachStorageListener()
    const settings = ThemeManager.getSettings(ThemeManager.activeServerId)
    ThemeManager.applyFont(settings.font)
    ThemeManager.repaint(settings)
    ThemeManager.loadPresetFonts()
  }

  public static loadPresetFonts(): void {
    if (typeof document === 'undefined') return
    let link = document.getElementById(ThemeManager.PRESETS_LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = ThemeManager.PRESETS_LINK_ID
      link.rel = 'stylesheet'
      const query = ThemeManager.FONT_PRESETS.map(
        (p) => `family=${p.name.trim().replace(/\s+/g, '+')}:wght@400;600`,
      ).join('&')
      link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`
      document.head.appendChild(link)
    }
  }

  private static attachStorageListener(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      ThemeManager.attachedWindow = null
      return
    }
    if (ThemeManager.attachedWindow === window) return
    window.addEventListener('storage', ThemeManager.handleStorageEvent)
    ThemeManager.attachedWindow = window
  }

  private static handleStorageEvent = (event: StorageEvent): void => {
    if (event.storageArea && typeof localStorage !== 'undefined' && event.storageArea !== localStorage) {
      return
    }
    if (event.key === null) {
      ThemeManager.memoryOverrides.clear()
      ThemeManager.snapshotCache.clear()
      if (!ThemeManager.activeServerId) return
      const settings = ThemeManager.getSettings(ThemeManager.activeServerId)
      ThemeManager.applyFont(settings.font)
      ThemeManager.repaint(settings)
      ThemeManager.emit(settings, ThemeManager.activeServerId)
      return
    }

    if (!event.key.startsWith(ThemeManager.STORAGE_PREFIX)) return
    const changedId = event.key.slice(ThemeManager.STORAGE_PREFIX.length)
    if (!changedId) return

    ThemeManager.memoryOverrides.delete(changedId)
    ThemeManager.snapshotCache.delete(changedId)
    const settings = ThemeManager.getSettings(changedId)
    if (ThemeManager.activeServerId === changedId) {
      ThemeManager.applyFont(settings.font)
      ThemeManager.repaint(settings)
    }
    ThemeManager.emit(settings, changedId)
  }

  private static resolveServerId(serverId?: string | null): string | null {
    return (serverId !== undefined ? serverId : ThemeManager.activeServerId) || null
  }

  private static update(
    serverId: string | null | undefined,
    updater: (current: ThemeSettings) => ThemeSettings | null,
    effects: { applyFont: boolean; repaint: boolean },
  ): boolean {
    const targetId = ThemeManager.resolveServerId(serverId)
    if (!targetId) return true

    const current = ThemeManager.getSettings(targetId)
    const updated = updater(current)
    if (!updated) return true

    const persisted = ThemeManager.writeServerEntry(targetId, updated)
    ThemeManager.lastWritePersisted = persisted
    if (persisted) {
      ThemeManager.memoryOverrides.delete(targetId)
    } else {
      ThemeManager.memoryOverrides.set(targetId, updated)
    }

    const committed = ThemeManager.cacheSnapshot(targetId, updated)
    if (ThemeManager.activeServerId === targetId) {
      if (effects.applyFont) ThemeManager.applyFont(committed.font)
      if (effects.repaint) ThemeManager.repaint(committed)
    }
    ThemeManager.emit(committed, targetId)
    return persisted
  }

  private static cacheSnapshot(serverId: string, candidate: ThemeSettings): ThemeSettings {
    const cached = ThemeManager.snapshotCache.get(serverId)
    if (
      cached &&
      cached.font === candidate.font &&
      cached.accent === candidate.accent &&
      cached.theme === candidate.theme &&
      cached.sidebar === candidate.sidebar &&
      cached.sidebarHover === candidate.sidebarHover &&
      cached.mode === candidate.mode
    ) {
      return cached
    }
    const frozen = Object.freeze({ ...candidate })
    ThemeManager.snapshotCache.set(serverId, frozen)
    return frozen
  }

  private static defaults(mode: ThemeMode = ThemeManager.DEFAULT_MODE): ThemeSettings {
    if (mode === 'light') {
      const light = ThemeManager.LIGHT_PRESETS[0]
      return {
        font: ThemeManager.DEFAULT_FONT,
        accent: light.accent,
        theme: light.name,
        sidebar: light.sidebar,
        sidebarHover: light.sidebarHover,
        mode: 'light',
      }
    }
    return { ...ThemeManager.DEFAULT_SNAPSHOT }
  }

  private static isLegacyFlatSettings(value: unknown): value is Partial<ThemeSettings> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return ['font', 'accent', 'theme', 'sidebar', 'sidebarHover', 'mode'].some(
      (field) => typeof record[field] === 'string',
    )
  }

  private static sanitize(raw?: Partial<ThemeSettings> | null): ThemeSettings {
    const mode: ThemeMode = raw?.mode === 'light' ? 'light' : 'dark'
    const defaults = ThemeManager.defaults(mode)
    if (!raw) return defaults
    const font = typeof raw.font === 'string' && raw.font.trim() ? raw.font.trim() : defaults.font
    const accent = typeof raw.accent === 'string' ? ThemeManager.formatHex(raw.accent) || defaults.accent : defaults.accent
    const theme = typeof raw.theme === 'string' && raw.theme.trim() ? raw.theme : defaults.theme
    const sidebar = typeof raw.sidebar === 'string' && raw.sidebar.trim() ? raw.sidebar : defaults.sidebar
    const sidebarHover =
      typeof raw.sidebarHover === 'string' && raw.sidebarHover.trim()
        ? raw.sidebarHover
        : defaults.sidebarHover
    return { font, accent, theme, sidebar, sidebarHover, mode }
  }

  /** Applies accent, color scheme, and sidebar tint together — every setter above funnels
   *  through this so they never drift out of sync. */
  private static repaint(settings: ThemeSettings): void {
    if (typeof document === 'undefined') return

    document.documentElement.setAttribute('data-theme', settings.mode)
    document.documentElement.style.colorScheme = settings.mode

    const metaColorScheme = document.querySelector('meta[name="color-scheme"]')
    if (metaColorScheme) {
      metaColorScheme.setAttribute('content', settings.mode)
    }

    ThemeManager.applyAccent(settings.accent)
    document.documentElement.style.setProperty('--sidebar', settings.sidebar)
    document.documentElement.style.setProperty('--sidebar-hover', settings.sidebarHover)
  }

  private static applyFont(fontName: string): void {
    if (typeof document === 'undefined') return

    // Inject Google Font link if it is not a system fallback or already built-in
    const link = ThemeManager.getOrCreateFontLink()
    // Typed by the user, so each word is encoded: a `&` or `#` would otherwise
    // end the family and rewrite the rest of the query.
    const formattedFamily = fontName.trim().split(/\s+/).map(encodeURIComponent).join('+')
    const nextHref = `https://fonts.googleapis.com/css2?family=${formattedFamily}:wght@300;400;500;600;700&display=swap`
    if (link.href !== nextHref) {
      link.href = nextHref
    }

    document.documentElement.style.setProperty(
      '--font-ui',
      `'${fontName.trim()}', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
    )
  }

  private static applyAccent(colorHex: string): void {
    if (typeof document === 'undefined') return

    const hex = ThemeManager.formatHex(colorHex)
    if (!hex) return

    document.documentElement.style.setProperty('--accent', hex)
    document.documentElement.style.setProperty(
      '--accent-soft',
      `color-mix(in srgb, ${hex} 15%, transparent)`,
    )

    // Calculate contrast text for solid accent badges/buttons
    const ink = ThemeManager.calculateContrastInk(hex)
    document.documentElement.style.setProperty('--accent-ink', ink)
  }

  private static readServerEntry(serverId: string): Partial<ThemeSettings> | null {
    try {
      const raw = localStorage.getItem(ThemeManager.storageKey(serverId))
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Partial<ThemeSettings>)
        : null
    } catch {
      return null
    }
  }

  private static hasStoredServerEntry(serverId: string): boolean {
    try {
      return localStorage.getItem(ThemeManager.storageKey(serverId)) !== null
    } catch {
      return false
    }
  }

  private static writeServerEntry(serverId: string, settings: ThemeSettings): boolean {
    try {
      localStorage.setItem(ThemeManager.storageKey(serverId), JSON.stringify(settings))
      return true
    } catch {
      return false
    }
  }

  private static removeServerEntry(serverId: string): boolean {
    try {
      localStorage.removeItem(ThemeManager.storageKey(serverId))
      return true
    } catch {
      return false
    }
  }

  private static getOrCreateFontLink(): HTMLLinkElement {
    let link = document.getElementById(ThemeManager.LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = ThemeManager.LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    return link
  }

  public static formatHex(hex: string): string {
    let clean = hex.trim()
    if (!clean.startsWith('#')) {
      clean = `#${clean}`
    }
    if (/^#[0-9a-fA-F]{6}$/.test(clean) || /^#[0-9a-fA-F]{3}$/.test(clean)) {
      return clean.toLowerCase()
    }
    return ''
  }

  private static calculateContrastInk(hex: string): string {
    let color = hex.replace('#', '')
    if (color.length === 3) {
      color = color.split('').map((c) => c + c).join('')
    }
    const r = parseInt(color.substring(0, 2), 16) || 0
    const g = parseInt(color.substring(2, 4), 16) || 0
    const b = parseInt(color.substring(4, 6), 16) || 0

    // YIQ formula for perceived brightness
    const yiq = (r * 299 + g * 587 + b * 114) / 1000
    return yiq >= 150 ? '#0a0c18' : '#ffffff'
  }
}
