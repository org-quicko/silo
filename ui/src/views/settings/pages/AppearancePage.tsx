import React, { useState, useEffect } from 'react'
import { Type, Palette, RotateCcw, Check, Sparkles, CheckCircle2 } from 'lucide-react'
import { Button } from '../../../components/Button'
import { Pill } from '../../../components/Pill'
import { TopBar } from '../../shell/TopBar'
import { ThemeManager, type ThemeSettings } from '../../../utils/theme-manager'
import styles from './AppearancePage.module.css'
import type { SessionBadge } from '../../shell/session-badge'

interface AppearancePageProps {
  session: SessionBadge
}

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

export function AppearancePage({ session }: AppearancePageProps) {
  const [settings, setSettings] = useState<ThemeSettings>(() => ThemeManager.getSettings())
  const [customFontInput, setCustomFontInput] = useState('')
  const [customHexInput, setCustomHexInput] = useState(settings.accent)
  const [savedSuccess, setSavedSuccess] = useState(false)

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

  const handleSelectAccent = (colorValue: string) => {
    ThemeManager.setAccent(colorValue)
    setSettings((prev) => ({ ...prev, accent: colorValue }))
    setCustomHexInput(colorValue)
    triggerSavedFeedback()
  }

  const handleCustomHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCustomHexInput(val)
    const formatted = ThemeManager.formatHex(val)
    if (formatted) {
      ThemeManager.setAccent(formatted)
      setSettings((prev) => ({ ...prev, accent: formatted }))
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
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2000)
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Application' }, { label: 'Appearance' }]} session={session}>
        {savedSuccess && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ok)', fontSize: '13px', fontWeight: 500 }}>
            <CheckCircle2 size={15} />
            <span>Theme applied</span>
          </div>
        )}
      </TopBar>

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Appearance</h2>
            <span className="page-sub">
              Typography and accent colour for the admin UI. Stored in this browser, so the choice
              applies to every silo server you open here — it is not part of any server's data.
            </span>
          </div>
        </div>

        <div className={styles.contentWrapper}>
          {/* Typography / Google Fonts Section */}
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.titleRow}>
                <Type size={16} className={styles.titleIcon} />
                <h2>Typography & Google Fonts</h2>
              </div>
              <p className={styles.sectionSubtitle}>
                Select a preset font or enter any Google Font family name. Silo dynamically loads and renders the font stylesheet.
              </p>
            </div>

            <div className={styles.presetsContainer}>
              <div className={styles.presetsHeaderRow}>
                <span className={styles.presetsLabel}>Popular Font Presets:</span>
                <span className={styles.presetsCount}>{ThemeManager.FONT_PRESETS.length} curated fonts</span>
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
                          <span className={styles.fontChipCat}>{preset.category}</span>
                          {isSelected && <Check size={13} className={styles.fontChipCheck} />}
                        </div>
                      </div>
                      <span className={styles.fontChipSample} style={fontStyle}>
                        Aa Bb Gg 123 · Quick brown fox
                      </span>
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

            {/* Typography Live Preview */}
            <div className={styles.previewBox}>
              <div className={styles.previewHeader}>
                <span className={styles.previewLabel}>Typography Preview</span>
                <span className={styles.previewFontTag}>{settings.font}</span>
              </div>
              <h3 className={styles.previewSampleHeading}>
                The quick brown fox jumps over the lazy dog
              </h3>
              <p className={styles.previewSampleBody}>
                Silo is a minimal, self-hostable headless CMS in a single binary. Define collections with standard JSON Schema, get forms and a CRUD API, and move your data anywhere.
              </p>
              <div className={styles.previewSampleElements}>
                <Pill tone="accent">Active Font: {settings.font}</Pill>
                <Pill tone="ok">Regular 400</Pill>
                <Pill tone="warn">SemiBold 600</Pill>
              </div>
            </div>
          </section>

          {/* Accent Color Section */}
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.titleRow}>
                <Palette size={16} className={styles.titleIcon} />
                <h2>Accent Color</h2>
              </div>
              <p className={styles.sectionSubtitle}>
                Customize the primary highlight, active badges, action buttons, and focus outlines across the workspace.
              </p>
            </div>

            <div className={styles.presetsContainer}>
              <span className={styles.presetsLabel}>Palette Presets:</span>
              <div className={styles.colorGrid}>
                {ThemeManager.COLOR_PRESETS.map((preset) => {
                  const isSelected = settings.accent.toLowerCase() === preset.value.toLowerCase()
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      className={`${styles.colorSwatchCard} ${isSelected ? styles.colorSwatchCardActive : ''}`}
                      onClick={() => handleSelectAccent(preset.value)}
                    >
                      <span className={styles.swatchCircle} style={{ background: preset.value }} />
                      <span>{preset.name}</span>
                    </button>
                  )
                })}
              </div>
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
                  if (hex) handleSelectAccent(hex)
                }}
              >
                <Check size={14} />
                <span>Apply Hex</span>
              </Button>
            </div>

            {/* Accent Color Live Preview */}
            <div className={styles.previewBox}>
              <div className={styles.previewHeader}>
                <span className={styles.previewLabel}>Theme UI Elements</span>
                <span className={styles.previewFontTag}>{settings.accent}</span>
              </div>
              <div className={styles.previewSampleElements}>
                <Button variant="primary">
                  <Check size={14} />
                  <span>Primary Action</span>
                </Button>
                <Button variant="secondary">Secondary Button</Button>
                <Pill tone="accent">Accent Tag</Pill>
                <Pill tone="ok">Live Status</Pill>
              </div>
            </div>
          </section>

          {/* Reset to Defaults Card */}
          <div className={styles.resetCard}>
            <div className={styles.resetInfo}>
              <h3>Reset Appearance</h3>
              <p>Revert typography and accent colors back to Silo default theme (Hanken Grotesk + Silo Indigo).</p>
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
