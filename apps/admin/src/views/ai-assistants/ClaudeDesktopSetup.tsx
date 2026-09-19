import { Download } from 'lucide-react'
import { useEffect, useRef } from 'react'
import button from '../../components/buttons/Button.module.css'
import type { Server } from '../servers/server'
import { SettingsRow } from '../settings/parts/SettingsRow'
import { SettingsSection } from '../settings/parts/SettingsSection'
import { AssistantTryPrompt } from './AssistantTryPrompt'
import { DesktopExtension } from './desktop-extension'
import styles from './AiAssistantsPage.module.css'

/** Downloads the self-contained Claude Desktop bundle for one saved server. */
export function ClaudeDesktopSetup({ server }: { server: Server }) {
  const downloadLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    const bytes = DesktopExtension.create(server)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
    if (downloadLink.current) downloadLink.current.href = url
    return () => URL.revokeObjectURL(url)
  }, [server])
  return <SettingsSection title="Claude Desktop">
    <SettingsRow label="Extension" help="The download carries this connection's URL and saved Silo key as its settings. Keep the extension private.">
      <a ref={downloadLink} className={`${button.button} ${button.primary}`} download={DesktopExtension.Filename}>
        <Download size={14} />
        Download extension
      </a>
    </SettingsRow>
    <p className={styles.note}>Open the downloaded <code>.mcpb</code> file and finish the Install prompt. Then enable the extension in Claude Desktop.</p>
    <p className={styles.note}>If it does not open, use Settings → Extensions → Advanced settings → Install Extension.</p>
    <p className={styles.note}>To use another Silo or key later, change the extension's Server URL and API key under Settings → Extensions → Silo.</p>
    <AssistantTryPrompt />
  </SettingsSection>
}
