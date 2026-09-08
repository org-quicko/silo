import React, { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import { ThemeManager, type ThemeSettings, type ThemePreset } from '../../../utils/theme-manager'
import { ToastManager } from '../../../utils/toast-manager'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import { FontFallback } from './font-fallback'
import ledger from '../parts/SettingsLedger.module.css'
import styles from './AppearancePage.module.css'

/**
 * Theme and typeface for the admin, stored in this browser.
 *
 * Nothing here reaches the server, so nothing here has a Save: every control
 * applies on the spot and Reset at the bottom puts it all back. That is also
 * why the page carries no scope chip — "this browser" is in the breadcrumb,
 * and every row on the page has the same answer.
 */
export function AppearancePage({ serverName }: { serverName: string }) {
  const [settings, setSettings] = useState<ThemeSettings>(() => ThemeManager.getSettings())
  const [customFontInput, setCustomFontInput] = useState('')
  const [customHexInput, setCustomHexInput] = useState(settings.accent)

  useEffect(() => {
    ThemeManager.loadPresetFonts()
  }, [])

  useEffect(() => {
    setCustomHexInput(settings.accent)
  }, [settings.accent])

  const applied = (what: string) => ToastManager.show(what)

  const selectFont = (fontName: string) => {
    ThemeManager.setFont(fontName)
    setSettings((prev) => ({ ...prev, font: fontName }))
    setCustomFontInput('')
    applied(`${fontName} applied`)
  }

  const applyCustomFont = (event: React.FormEvent) => {
    event.preventDefault()
    const font = customFontInput.trim()
    if (!font) return
    ThemeManager.setFont(font)
    setSettings((prev) => ({ ...prev, font }))
    applied(`${font} applied`)
  }

  const selectTheme = (theme: ThemePreset) => {
    ThemeManager.setTheme(theme.name)
    setSettings((prev) => ({
      ...prev,
      theme: theme.name,
      accent: theme.accent,
      sidebar: theme.sidebar,
      sidebarHover: theme.sidebarHover,
    }))
    setCustomHexInput(theme.accent)
    applied(`${theme.name} applied`)
  }

  const applyHex = (value: string) => {
    const hex = ThemeManager.formatHex(value)
    if (!hex) return
    ThemeManager.setAccent(hex)
    setSettings((prev) => ({ ...prev, accent: hex, theme: 'Custom' }))
    applied('Accent applied')
  }

  const reset = () => {
    const defaults = ThemeManager.reset()
    setSettings(defaults)
    setCustomFontInput('')
    setCustomHexInput(defaults.accent)
    applied('Appearance reset')
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb
          crumbs={[{ label: serverName }, { label: 'This browser' }, { label: 'Appearance' }]}
        />
        <SettingsPageHead title="Appearance" />

        <SettingsSection title="Theme">
          <SettingsRow label="Presets" help="Choose a theme for Silo on this device." inline>
            <div className={styles.swatches}>
              {ThemeManager.THEME_PRESETS.map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  className={styles.swatch}
                  style={{ background: theme.accent }}
                  aria-pressed={settings.theme === theme.name}
                  aria-label={theme.name}
                  title={theme.name}
                  onClick={() => selectTheme(theme)}
                />
              ))}
            </div>
          </SettingsRow>

          <SettingsRow
            label="Custom"
            htmlFor="accent-hex"
            help="Any hex — contrast is derived from it automatically."
          >
            <div className={styles.hexRow}>
              <input
                id="accent-hex"
                className={`${ledger.field} ${ledger.fieldMono}`}
                type="text"
                value={customHexInput}
                maxLength={7}
                spellCheck={false}
                placeholder="#7c86ff"
                onChange={(event) => setCustomHexInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && applyHex(customHexInput)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!ThemeManager.formatHex(customHexInput)}
                onClick={() => applyHex(customHexInput)}
              >
                Apply
              </Button>
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Typeface">
          <SettingsRow label="Fonts" stack>
            <div className={styles.fonts}>
              {ThemeManager.FONT_PRESETS.map((preset) => {
                const active = settings.font.toLowerCase() === preset.name.toLowerCase()
                return (
                  <button
                    key={preset.name}
                    type="button"
                    className={`${styles.font} ${active ? styles.fontActive : ''}`}
                    aria-pressed={active}
                    onClick={() => selectFont(preset.name)}
                  >
                    <span
                      className={styles.fontName}
                      style={{ fontFamily: `'${preset.name}', ${FontFallback.of(preset.category)}` }}
                    >
                      {preset.name}
                    </span>
                    <span className={styles.fontCategory}>{preset.category}</span>
                  </button>
                )
              })}
            </div>
          </SettingsRow>

          <SettingsRow
            label="Any other Google font"
            htmlFor="custom-font"
            help="Any family name from fonts.google.com."
          >
            <form className={styles.hexRow} onSubmit={applyCustomFont}>
              <input
                id="custom-font"
                className={ledger.field}
                type="text"
                placeholder="Libre Franklin"
                value={customFontInput}
                onChange={(event) => setCustomFontInput(event.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!customFontInput.trim()}>
                Apply
              </Button>
            </form>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Reset">
          <SettingsRow
            label="Back to Silo defaults"
            help={`${ThemeManager.DEFAULT_FONT} and ${ThemeManager.DEFAULT_THEME}.`}
            inline
          >
            <Button type="button" variant="secondary" onClick={reset}>
              <RotateCcw size={14} />
              <span>Reset appearance</span>
            </Button>
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  )
}
