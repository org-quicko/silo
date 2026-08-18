export interface ThemeSettings {
  font: string
  accent: string
}

export interface FontPreset {
  name: string
  category: 'Sans-Serif' | 'Serif' | 'Display' | 'Monospace'
}

export interface ColorPreset {
  name: string
  value: string
}

export class ThemeManager {
  private static readonly STORAGE_KEY = 'silo_appearance_settings'
  private static readonly LINK_ID = 'silo-google-font'
  private static readonly PRESETS_LINK_ID = 'silo-google-font-presets'

  public static readonly DEFAULT_FONT = 'Hanken Grotesk'
  public static readonly DEFAULT_ACCENT = '#7c86ff'

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

  public static readonly COLOR_PRESETS: ColorPreset[] = [
    { name: 'Silo Indigo', value: '#7c86ff' },
    { name: 'Electric Violet', value: '#8b5cf6' },
    { name: 'Sky Blue', value: '#0ea5e9' },
    { name: 'Cyan Glow', value: '#06b6d4' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Amber Gold', value: '#f59e0b' },
    { name: 'Warm Coral', value: '#ff6b6b' },
    { name: 'Rose Pink', value: '#f43f5e' },
    { name: 'Magenta Pulse', value: '#d946ef' },
    { name: 'Sunset Orange', value: '#f97316' },
    { name: 'Lime Volt', value: '#84cc16' },
  ]

  public static getSettings(): ThemeSettings {
    try {
      const raw = localStorage.getItem(ThemeManager.STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          font: parsed.font || ThemeManager.DEFAULT_FONT,
          accent: parsed.accent || ThemeManager.DEFAULT_ACCENT,
        }
      }
    } catch {
      /* ignore storage failure */
    }
    return {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
    }
  }

  public static setFont(fontName: string): void {
    const trimmed = fontName.trim() || ThemeManager.DEFAULT_FONT
    const current = ThemeManager.getSettings()
    const updated = { ...current, font: trimmed }
    ThemeManager.saveSettings(updated)
    ThemeManager.applyFont(trimmed)
  }

  public static setAccent(colorHex: string): void {
    const formatted = ThemeManager.formatHex(colorHex) || ThemeManager.DEFAULT_ACCENT
    const current = ThemeManager.getSettings()
    const updated = { ...current, accent: formatted }
    ThemeManager.saveSettings(updated)
    ThemeManager.applyAccent(formatted)
  }

  public static reset(): ThemeSettings {
    const defaults: ThemeSettings = {
      font: ThemeManager.DEFAULT_FONT,
      accent: ThemeManager.DEFAULT_ACCENT,
    }
    ThemeManager.saveSettings(defaults)
    ThemeManager.applyFont(defaults.font)
    ThemeManager.applyAccent(defaults.accent)
    return defaults
  }

  public static init(): void {
    const settings = ThemeManager.getSettings()
    ThemeManager.applyFont(settings.font)
    ThemeManager.applyAccent(settings.accent)
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
