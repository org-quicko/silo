import React, { useState, useEffect } from 'react'
import { RotateCcw, Check, Sparkles } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import { ThemeManager, type ThemeSettings, type ThemePreset } from '../../../utils/theme-manager'
import { ToastManager } from '../../../utils/toast-manager'
import styles from './AppearancePage.module.css'

function getCategoryFallback(category: string): string {
  switch (category) {
    case 'Serif':
      return 'Georgia, "Times New Roman", serif'
    case 'Monospace':
      return '"JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, monospace'
    case 'Display':
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    default:
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  }
}

export function AppearancePage() {
  const [settings, setSettings] = useState<ThemeSettings>(() => ThemeManager.getSettings())
  const [customFontInput, setCustomFontInput] = useState('')
  const [customHexInput, setCustomHexInput] = useState(settings.accent)

  useEffect(() => {
    ThemeManager.loadPresetFonts()
  }, [])

  useEffect(() => {
    setCustomHexInput(settings.accent)
  }, [settings.accent])

  const handleSelectFont = (fontName: string) => {
    ThemeManager.setFont(fontName)
    setSettings((prev) => ({ ...prev, font: fontName }))
    setCustomFontInput('')
    triggerSavedFeedback()
  }

  const handleApplyCustomFont = (e: React.FormEvent) => {
    e.preventDefault()
    const font = customFontInput.trim()
    if (!font) return
    ThemeManager.setFont(font)
    setSettings((prev) => ({ ...prev, font }))
    triggerSavedFeedback()
  }

  const handleSelectTheme = (theme: ThemePreset) => {
    ThemeManager.setTheme(theme.name)
    setSettings((prev) => ({ ...prev, theme: theme.name, accent: theme.accent, sidebar: theme.sidebar, sidebarHover: theme.sidebarHover }))
    setCustomHexInput(theme.accent)
    triggerSavedFeedback()
  }

  const handleCustomHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCustomHexInput(val)
    const formatted = ThemeManager.formatHex(val)
    if (formatted) {
      ThemeManager.setAccent(formatted)
      setSettings((prev) => ({ ...prev, accent: formatted, theme: 'Custom' }))
      triggerSavedFeedback()
    }
  }

  const handleResetDefaults = () => {
    const defaults = ThemeManager.reset()
    setSettings(defaults)
    setCustomFontInput('')
    setCustomHexInput(defaults.accent)
    triggerSavedFeedback()
  }

  const triggerSavedFeedback = () => {
    ToastManager.show('Theme applied')
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'Application' }, { label: 'Appearance' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Appearance</h2>
            <span className="page-sub">
              Theme, typography and accent for the admin UI. Stored in this browser, so the choice applies
              to every silo server you open here.
            </span>
          </div>
        </div>

        <div className={styles.contentWrapper}>
          {/* Themes Section */}
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.titleRow}>
                <h2>Themes</h2>
              </div>
            </div>

            <div className={styles.themeGrid}>
              {ThemeManager.THEME_PRESETS.map((theme) => {
                const isActive = settings.theme === theme.name
                return (
                  <button
                    key={theme.name}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ''}`}
                    onClick={() => handleSelectTheme(theme)}
                  >
                    <span className={styles.orb} style={{ background: theme.accent }} />
                    <span className={styles.themeName}>
                      {theme.name}
                      {theme.description && <small>{theme.description}</small>}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Custom Color Input & Color Picker */}
            <div className={styles.colorPickerRow}>
              <label className={styles.colorPickerWrapper} title="Open color picker">
                <div className={styles.colorPreviewDisc} style={{ background: settings.accent }} />
                <input
                  type="color"
                  className={styles.colorInputHidden}
                  value={ThemeManager.formatHex(settings.accent) || '#7c86ff'}
                  onChange={handleCustomHexChange}
                />
              </label>

              <input
                type="text"
                className={styles.hexInput}
                placeholder="#7c86ff"
                value={customHexInput}
                onChange={handleCustomHexChange}
                maxLength={7}
              />

              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const hex = ThemeManager.formatHex(customHexInput)
                  if (hex) {
                    ThemeManager.setAccent(hex)
                    setSettings((prev) => ({ ...prev, accent: hex, theme: 'Custom' }))
                    triggerSavedFeedback()
                  }
                }}
              >
                <Check size={14} />
                <span>Apply Hex</span>
              </Button>
            </div>
          </section>

          {/* Typography / Google Fonts Section */}
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.titleRow}>
                <h2>Fonts</h2>
              </div>
            </div>

            <div className={styles.presetsContainer}>
              <div className={styles.presetsHeaderRow}>
                <span className={styles.presetsLabel}>Popular fonts:</span>
              </div>
              <div className={styles.fontGrid}>
                {ThemeManager.FONT_PRESETS.map((preset) => {
                  const isSelected = settings.font.toLowerCase() === preset.name.toLowerCase()
                  const fontStyle = {
                    fontFamily: `'${preset.name}', ${getCategoryFallback(preset.category)}`,
                  }
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      className={`${styles.fontChip} ${isSelected ? styles.fontChipActive : ''}`}
                      onClick={() => handleSelectFont(preset.name)}
                    >
                      <div className={styles.fontChipHeader}>
                        <span className={styles.fontChipName} style={fontStyle}>
                          {preset.name}
                        </span>
                        <div className={styles.fontChipMeta}>
                          {isSelected ? (
                            <Check size={13} className={styles.fontChipCheck} />
                          ) : (
                            <span className={styles.fontChipCat}>{preset.category}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Custom Google Font input */}
            <form onSubmit={handleApplyCustomFont} className={styles.customInputRow}>
              <input
                type="text"
                className={styles.customInput}
                placeholder="Type any Google Font (e.g. Outfit, Space Grotesk, Cinzel, Poppins)…"
                value={customFontInput}
                onChange={(e) => setCustomFontInput(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!customFontInput.trim()}>
                <Sparkles size={14} />
                <span>Apply Font</span>
              </Button>
            </form>
            <p className={styles.fontHelperText}>
              You can use any font family available on <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>fonts.google.com</a>.
            </p>
          </section>

          {/* Reset to Defaults Card */}
          <div className={styles.resetCard}>
            <div className={styles.resetInfo}>
              <h3>Reset Appearance</h3>
              <p>Revert theme, typography and accent back to Silo default (Hanken Grotesk + Silo Indigo).</p>
            </div>
            <Button type="button" variant="secondary" onClick={handleResetDefaults}>
              <RotateCcw size={14} />
              <span>Reset Defaults</span>
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
