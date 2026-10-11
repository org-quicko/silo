import { useState } from 'react'
import { Segmented } from '../../components/controls/Segmented'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import type { Server } from '../servers/server'
import { SettingsPageHead } from '../settings/parts/SettingsPageHead'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import { AiAssistantOptions, type AiAssistant } from './ai-assistant'
import { ClaudeCodeSetup } from './ClaudeCodeSetup'
import { ClaudeDesktopSetup } from './ClaudeDesktopSetup'
import { CodexSetup } from './CodexSetup'
import { CursorSetup } from './CursorSetup'

/** Chooses one assistant, then renders its current-connection setup action. */
export function AiAssistantsPage({ server }: { server: Server }) {
  const [assistant, setAssistant] = useState<AiAssistant>('claude-desktop')
  return <div className="content">
    <Breadcrumb crumbs={[{ label: server.name }, { label: 'AI assistants' }]} />
    <SettingsPageHead title="Connect an AI assistant" sub="Uses the same access as your current Silo connection." />
    <SettingsSection title="Choose an assistant">
      <SettingsRow label="Assistant" stack>
        <Segmented value={assistant} options={AiAssistantOptions} onChange={setAssistant} variant="fit" />
      </SettingsRow>
    </SettingsSection>
    {assistant === 'claude-desktop' && <ClaudeDesktopSetup server={server} />}
    {assistant === 'claude-code' && <ClaudeCodeSetup server={server} />}
    {assistant === 'codex' && <CodexSetup server={server} />}
    {assistant === 'cursor' && <CursorSetup server={server} />}
  </div>
}
