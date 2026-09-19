import { useState } from 'react'
import { CopyButton } from '../../components/buttons/CopyButton'
import { Segmented } from '../../components/controls/Segmented'
import type { Server } from '../servers/server'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import { AssistantTryPrompt } from './AssistantTryPrompt'
import { AiAssistantConfig } from './ai-assistant-config'
import type { Shell } from './ai-assistant'
import styles from './AiAssistantsPage.module.css'

/** Creates the Claude Code command for the operator's shell. */
export function ClaudeCodeSetup({ server }: { server: Server }) {
  const [shell, setShell] = useState<Shell>('posix')
  const command = AiAssistantConfig.claudeCode(server, shell)
  return <SettingsSection title="Claude Code">
    <SettingsRow label="Shell" inline>
      <Segmented value={shell} options={[{ value: 'posix', label: 'macOS / Linux' }, { value: 'powershell', label: 'PowerShell' }]} onChange={setShell} variant="fit" />
    </SettingsRow>
    <SettingsRow label="Command" stack help="Run this once in the shell where Claude Code is installed.">
      <code className={styles.code}>{command}</code>
      <CopyButton text={command} label="Copy command" />
    </SettingsRow>
    <p className={styles.note}>This command contains your saved Silo key. Keep shell history and copied commands private. Run <code>/mcp</code> in Claude Code to confirm the server appears.</p>
    <AssistantTryPrompt />
  </SettingsSection>
}
