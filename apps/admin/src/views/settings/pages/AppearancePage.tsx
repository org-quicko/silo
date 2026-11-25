import React, { useState, useEffect, useRef } from 'react'
import { RotateCcw, Sun, Moon } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import { ThemeManager, type ThemePreset, type ThemeMode } from '../../../utils/theme-manager'
import { useThemeSettings } from '../../../utils/use-theme-mode'
import { ToastManager } from '../../../utils/toast-manager'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import { FontFallback } from './font-fallback'
import ledger from '../parts/SettingsLedger.module.css'
import styles from './AppearancePage.module.css'

/**
 * Theme and typeface for one saved server, stored locally in this browser.
 *
 * Nothing here reaches the server, so nothing here has a Save: every control
 * applies on the spot and Reset at the bottom puts this server back to defaults.
 */
export function AppearancePage({ server }: { server: Server }) {
  const settings = useThemeSettings(server.id)
  const [customFontInput, setCustomFontInput] = useState('')
  const [customHexInput, setCustomHexInput] = useState(settings.accent)
  const appliedAccentRef = useRef(settings.accent)

  useEffect(() => {
    ThemeManager.loadPresetFonts()
  }, [])

  useEffect(() => {
    return ThemeManager.subscribe((newSettings, changedServerId) => {
      if (changedServerId !== server.id) return
      // Only overwrite the custom hex draft when the applied accent itself changes
      // (e.g. preset click, mode switch, Apply, or another tab) so editing the font
      // does not discard an unapplied hex draft.
      if (newSettings.accent !== appliedAccentRef.current) {
        appliedAccentRef.current = newSettings.accent
        setCustomHexInput(newSettings.accent)
      }
    })
  }, [server.id])

  const applied = (what: string, persisted: boolean) =>
    ToastManager.show(persisted ? what : `${what} (not saved — browser storage unavailable)`)

  const selectMode = (mode: ThemeMode) => {
    const persisted = ThemeManager.setMode(mode, server.id)
    applied(mode === 'light' ? 'Light mode applied' : 'Dark mode applied', persisted)
  }

  const selectFont = (fontName: string) => {
    const persisted = ThemeManager.setFont(fontName, server.id)
    setCustomFontInput('')
    applied(`${fontName} applied`, persisted)
  }

  const applyCustomFont = (event: React.FormEvent) => {
    event.preventDefault()
    const font = customFontInput.trim()
    if (!font) return
    const persisted = ThemeManager.setFont(font, server.id)
    applied(`${font} applied`, persisted)
  }

  const selectTheme = (theme: ThemePreset) => {
    const persisted = ThemeManager.setTheme(theme.name, server.id)
    applied(`${theme.name} applied`, persisted)
  }

  const applyHex = (value: string) => {
    const hex = ThemeManager.formatHex(value)
    if (!hex) return
    const persisted = ThemeManager.setAccent(hex, server.id)
    appliedAccentRef.current = hex
    setCustomHexInput(hex)
    applied('Accent applied', persisted)
  }

  const reset = () => {
    const defaults = ThemeManager.reset(server.id)
    setCustomFontInput('')
    appliedAccentRef.current = defaults.accent
    setCustomHexInput(defaults.accent)
    applied('Appearance reset', ThemeManager.isLastWritePersisted())
  }

  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Appearance' }]} />
        <SettingsPageHead
          title="Appearance"
          sub="Stored in this browser for this server."
        />

        <SettingsSection title="Theme">
          <SettingsRow
            label="Theme mode"
            help="Switch between dark and parchment light appearance for this server."
            inline
          >
            <button
              type="button"
              className={styles.themeToggleBtn}
              onClick={() => selectMode(settings.mode === 'light' ? 'dark' : 'light')}
              title={settings.mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={settings.mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {settings.mode === 'light' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </SettingsRow>

          <SettingsRow label="Presets" help="Choose a theme for this server in this browser." inline>
            <div className={styles.swatches}>
              {ThemeManager.getPresets(settings.mode).map((theme) => (
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
