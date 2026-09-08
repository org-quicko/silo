import type { FontPreset } from '../../../utils/theme-manager'

/**
 * What a specimen falls back to while its family is still loading.
 *
 * A serif specimen briefly rendered in a sans is a card that shows the wrong
 * answer, so the fallback matches the category rather than being one stack for
 * everything.
 */
export class FontFallback {
  static of(category: FontPreset['category']): string {
    switch (category) {
      case 'Serif':
        return 'Georgia, "Times New Roman", serif'
      case 'Monospace':
        return 'var(--font-mono), ui-monospace, Menlo, monospace'
      default:
        return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    }
  }
}
