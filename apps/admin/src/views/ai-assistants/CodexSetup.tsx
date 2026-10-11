import { CopyButton } from '../../components/buttons/CopyButton'
import type { Server } from '../servers/server'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import { AssistantTryPrompt } from './AssistantTryPrompt'
import { AiAssistantConfig } from './ai-assistant-config'
import styles from './AiAssistantsPage.module.css'

/** Shows the one TOML block an operator merges into personal Codex settings. */
export function CodexSetup({ server }: { server: Server }) {
  const toml = AiAssistantConfig.codexToml(server)
  const setupPrompt = `Add the Silo MCP server below to my personal Codex configuration at ~/.codex/config.toml (or CODEX_HOME if configured). Preserve all other settings and existing MCP servers; update this server if it exists. Then tell me how to reload Codex so I can use it.\n\n${toml}`
  return <SettingsSection title="Codex">
    <SettingsRow label="Setup" stack help="Paste this into a local Codex task and let it add the connection.">
      <CopyButton text={setupPrompt} variant="accent" label="Copy setup prompt" />
    </SettingsRow>
    <p className={styles.note}>Approve the configuration change if Codex asks. A cloud task cannot change your personal local configuration.</p>
    <details className={styles.manual}>
      <summary>Configure manually instead</summary>
      <p>Append or update only this block in <code>~/.codex/config.toml</code>; keep your other configuration.</p>
      <code className={styles.code}>{toml}</code>
      <CopyButton text={toml} label="Copy configuration" />
    </details>
    <p className={styles.note}>This personal configuration is shared by Codex apps, CLI and IDE integrations. Keep it private because it contains your Silo key.</p>
    <AssistantTryPrompt />
  </SettingsSection>
}
