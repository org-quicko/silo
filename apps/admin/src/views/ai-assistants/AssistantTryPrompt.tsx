import { CopyButton } from '../../components/buttons/CopyButton'
import { SettingsRow } from '../settings/parts/SettingsRow'
import styles from './AiAssistantsPage.module.css'

const Prompt = 'What Silo access do I have? List the available collections.'

/** A small first request that works with every client after setup completes. */
export function AssistantTryPrompt() {
  return <SettingsRow label="Try it" stack help="When setup is complete, ask your assistant:">
    <code className={styles.prompt}>{Prompt}</code>
    <CopyButton text={Prompt} label="Copy prompt" />
  </SettingsRow>
}
