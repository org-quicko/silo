import { ExternalLink } from 'lucide-react'
import { CopyButton } from '../../components/buttons/CopyButton'
import button from '../../components/buttons/Button.module.css'
import type { Server } from '../servers/server'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import { AssistantTryPrompt } from './AssistantTryPrompt'
import { AiAssistantConfig } from './ai-assistant-config'
import styles from './AiAssistantsPage.module.css'

/** Opens Cursor's native direct install URI with a JSON fallback. */
export function CursorSetup({ server }: { server: Server }) {
  const uri = AiAssistantConfig.cursorUri(server)
  const json = AiAssistantConfig.cursorJson(server)
  return <SettingsSection title="Cursor">
    <SettingsRow label="Install" help="Cursor receives this saved Silo key. Keep the resulting local configuration private.">
      <a className={`${button.button} ${button.primary}`} href={uri}>
        Add to Cursor <ExternalLink size={14} />
      </a>
    </SettingsRow>
    <p className={styles.note}>Approve Cursor’s install dialog, then check Settings → Tools & MCP.</p>
    <details className={styles.manual}>
      <summary>Configure manually instead</summary>
      <p>Merge this into <code>~/.cursor/mcp.json</code> on macOS/Linux or <code>%USERPROFILE%\.cursor\mcp.json</code> on Windows; do not replace existing servers.</p>
      <code className={styles.code}>{json}</code>
      <CopyButton text={json} label="Copy JSON" />
    </details>
    <AssistantTryPrompt />
  </SettingsSection>
}
