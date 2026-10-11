export type AiAssistant = 'claude-desktop' | 'claude-code' | 'codex' | 'cursor'
export type Shell = 'posix' | 'powershell'

export const AiAssistantOptions: { value: AiAssistant; label: string }[] = [
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
]
