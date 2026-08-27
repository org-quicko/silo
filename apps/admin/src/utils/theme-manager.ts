export interface ThemeSettings {
  font: string
  accent: string
  theme: string
  sidebar: string
  sidebarHover: string
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
  group: 'Theme' | 'Vision assistive'
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
  // Matches the shipped --panel/--panel-2 values, so the default theme
  // repaints the sidebar to exactly what it already looked like.
  public static readonly DEFAULT_SIDEBAR = '#14171f'
  public static readonly DEFAULT_SIDEBAR_HOVER = '#1c202a'

  public static readonly FONT_PRESETS: FontPreset[] = [
    { name: 'Hanken Grotesk', category: 'Sans-Serif' },
    { name: 'Inter', category: 'Sans-Serif' },
    { name: 'Outfit', category: 'Sans-Serif' },
    { name: 'Plus Jakarta Sans', category: 'Sans-Serif' },
    { name: 'Poppins', category: 'Sans-Serif' },
    { name: 'DM Sans', category: 'Sans-Serif' },
    { name: 'Space Grotesk', category: 'Sans-Serif' },
    { name: 'Montserrat', category: 'Sans-Serif' },
    { name: 'Raleway', category: 'Sans-Serif' },
    { name: 'Nunito', category: 'Sans-Serif' },
    { name: 'Rubik', category: 'Sans-Serif' },
    { name: 'Playfair Display', category: 'Serif' },
    { name: 'Lora', category: 'Serif' },
    { name: 'Merriweather', category: 'Serif' },
    { name: 'Cinzel', category: 'Serif' },
    { name: 'Syne', category: 'Display' },
    { name: 'Bricolage Grotesque', category: 'Display' },
    { name: 'JetBrains Mono', category: 'Monospace' },
    { name: 'Fira Code', category: 'Monospace' },
  ]

  // Curated to a spread of visually distinct hues rather than every shade —
  // near-duplicates (Cyan Glow beside Sky Blue, Teal beside Emerald, Magenta
  // Pulse beside Electric Violet, Sunset Orange beside Amber Gold, Lime Volt
  // beside Emerald) added variety without adding a meaningfully different
  // choice, so they're gone rather than kept for the sake of a bigger grid.
  public static readonly THEME_PRESETS: ThemePreset[] = [
    { name: 'Silo Indigo', description: 'Default', group: 'Theme', accent: ThemeManager.DEFAULT_ACCENT, sidebar: ThemeManager.DEFAULT_SIDEBAR, sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER },
    { name: 'Electric Violet', group: 'Theme', accent: '#8b5cf6', sidebar: '#1d1630', sidebarHover: '#2a2040' },
    { name: 'Sky Blue', group: 'Theme', accent: '#38bdf8', sidebar: '#101d2b', sidebarHover: '#19293b' },
    { name: 'Emerald', group: 'Theme', accent: '#34d399', sidebar: '#0f1f1a', sidebarHover: '#172c25' },
    { name: 'Amber Gold', group: 'Theme', accent: '#f59e0b', sidebar: '#221a10', sidebarHover: '#302617' },
    { name: 'Rose Pink', group: 'Theme', accent: '#f43f5e', sidebar: '#26121a', sidebarHover: '#351b26' },
    // Vision assistive — colour-blind-safe accent/sidebar pairs.
    { name: 'Tritanopia', description: 'Blue / red safe', group: 'Vision assistive', accent: '#2f81f7', sidebar: '#12161c', sidebarHover: '#1d242e' },
    { name: 'Protanopia & Deuteranopia', description: 'Blue / yellow safe', group: 'Vision assistive', accent: '#4c8df6', sidebar: '#171224', sidebarHover: '#231a33' },
  ]

  public static getSettings(): ThemeSettings {
    const defaults: ThemeSettings = {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
      theme: ThemeManager.DEFAULT_THEME,
      sidebar: ThemeManager.DEFAULT_SIDEBAR,
      sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER,
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
        }
      }
    } catch {
      /* ignore storage failure */
    }
    return defaults
  }

  public static setFont(fontName: string): void {
    const trimmed = fontName.trim() || ThemeManager.DEFAULT_FONT
    ThemeManager.saveSettings({ ...ThemeManager.getSettings(), font: trimmed })
    ThemeManager.applyFont(trimmed)
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
  }

  public static setAccent(colorHex: string): void {
    const formatted = ThemeManager.formatHex(colorHex) || ThemeManager.DEFAULT_ACCENT
    const updated: ThemeSettings = { ...ThemeManager.getSettings(), accent: formatted, theme: 'Custom' }
    ThemeManager.saveSettings(updated)
    ThemeManager.repaint(updated)
  }

  public static reset(): ThemeSettings {
    const defaults: ThemeSettings = {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
      theme: ThemeManager.DEFAULT_THEME,
      sidebar: ThemeManager.DEFAULT_SIDEBAR,
      sidebarHover: ThemeManager.DEFAULT_SIDEBAR_HOVER,
    }
    ThemeManager.saveSettings(defaults)
    ThemeManager.applyFont(defaults.font)
    ThemeManager.repaint(defaults)
    return defaults
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

  /** Applies accent and sidebar tint together — every setter above funnels
   *  through this so the two never drift out of sync. */
  private static repaint(settings: ThemeSettings): void {
    if (typeof document === 'undefined') return
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
