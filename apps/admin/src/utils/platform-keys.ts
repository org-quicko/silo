/**
 * How this platform writes the modifier keys the app's shortcuts use. Both
 * shortcuts already listen for either modifier; only the labels were Apple's,
 * so a Windows reader was told to press a key their keyboard does not have.
 */
export class PlatformKeys {
  /** Apple platforms label the modifiers ⌘ and ⌥; everywhere else it is Ctrl and Alt. */
  static isApple(platform: string = PlatformKeys.platform()): boolean {
    return /mac|iphone|ipad|ipod/i.test(platform)
  }

  /** The label to put before the key: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
  static command(platform?: string): string {
    return PlatformKeys.isApple(platform) ? '⌘' : 'Ctrl+'
  }

  static alt(platform?: string): string {
    return PlatformKeys.isApple(platform) ? '⌥' : 'Alt+'
  }

  /** `userAgentData` where it exists, then the deprecated `platform`, then the UA string. */
  private static platform(): string {
    if (typeof navigator === 'undefined') return ''
    const data = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
    return data?.platform || navigator.platform || navigator.userAgent || ''
  }
}
