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

export class ThemeManager {
  private static readonly STORAGE_KEY = 'silo_appearance_settings'
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

  private static listeners = new Set<(settings: ThemeSettings) => void>()

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

  public static getPresets(mode?: ThemeMode): ThemePreset[] {
    const activeMode = mode || ThemeManager.getSettings().mode
    return activeMode === 'light' ? ThemeManager.LIGHT_PRESETS : ThemeManager.DARK_PRESETS
  }

  public static getSettings(): ThemeSettings {
    const defaults: ThemeSettings = {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
      theme: ThemeManager.DEFAULT_THEME,
      sidebar: ThemeManager.DEFAULT_SIDEBAR,
      sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER,
      mode: ThemeManager.DEFAULT_MODE,
    }
    try {
      const raw = localStorage.getItem(ThemeManager.STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          font: parsed.font || defaults.font,
          accent: parsed.accent || defaults.accent,
          theme: parsed.theme || defaults.theme,
          sidebar: parsed.sidebar || defaults.sidebar,
          sidebarHover: parsed.sidebarHover || defaults.sidebarHover,
          mode: parsed.mode === 'light' ? 'light' : 'dark',
        }
      }
    } catch {
      /* ignore storage failure */
    }
    return defaults
  }

  public static setFont(fontName: string): void {
    const trimmed = fontName.trim() || ThemeManager.DEFAULT_FONT
    const updated = { ...ThemeManager.getSettings(), font: trimmed }
    ThemeManager.saveSettings(updated)
    ThemeManager.applyFont(trimmed)
    ThemeManager.emit(updated)
  }

  public static setTheme(themeName: string): void {
    const preset = ThemeManager.THEME_PRESETS.find((t) => t.name === themeName)
    if (!preset) return
    const updated: ThemeSettings = {
      ...ThemeManager.getSettings(),
      theme: preset.name,
      accent: preset.accent,
      sidebar: preset.sidebar,
      sidebarHover: preset.sidebarHover,
    }
    ThemeManager.saveSettings(updated)
    ThemeManager.repaint(updated)
    ThemeManager.emit(updated)
  }

  public static setAccent(colorHex: string): void {
    const formatted = ThemeManager.formatHex(colorHex) || ThemeManager.DEFAULT_ACCENT
    const updated: ThemeSettings = { ...ThemeManager.getSettings(), accent: formatted, theme: 'Custom' }
    ThemeManager.saveSettings(updated)
    ThemeManager.repaint(updated)
    ThemeManager.emit(updated)
  }

  public static setMode(mode: ThemeMode): void {
    const current = ThemeManager.getSettings()
    if (current.mode === mode) return

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

    const updated: ThemeSettings = {
      ...current,
      mode,
      theme: nextTheme,
      accent: nextAccent,
      sidebar: nextSidebar,
      sidebarHover: nextSidebarHover,
    }
    ThemeManager.saveSettings(updated)
    ThemeManager.repaint(updated)
    ThemeManager.emit(updated)
  }

  public static reset(): ThemeSettings {
    const defaults: ThemeSettings = {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
      theme: ThemeManager.DEFAULT_THEME,
      sidebar: ThemeManager.DEFAULT_SIDEBAR,
      sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER,
      mode: ThemeManager.DEFAULT_MODE,
    }
    ThemeManager.saveSettings(defaults)
    ThemeManager.applyFont(defaults.font)
    ThemeManager.repaint(defaults)
    ThemeManager.emit(defaults)
    return defaults
  }

  public static subscribe(listener: (settings: ThemeSettings) => void): () => void {
    ThemeManager.listeners.add(listener)
    return () => ThemeManager.listeners.delete(listener)
  }

  private static emit(settings: ThemeSettings): void {
    for (const listener of ThemeManager.listeners) {
      try {
        listener(settings)
      } catch {
        /* ignore listener failure */
      }
    }
  }

  public static init(): void {
    const settings = ThemeManager.getSettings()
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
    const formattedFamily = fontName.trim().replace(/\s+/g, '+')
    link.href = `https://fonts.googleapis.com/css2?family=${formattedFamily}:wght@300;400;500;600;700&display=swap`

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

  private static saveSettings(settings: ThemeSettings): void {
    try {
      localStorage.setItem(ThemeManager.STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* ignore storage failure */
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
