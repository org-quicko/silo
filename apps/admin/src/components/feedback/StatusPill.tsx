import { Pill } from './Pill'

// StatusPill picks a color by common status vocabulary; unknown values render
// as a neutral chip. Used in the entries table for enum-ish string values.
export function StatusPill({ value }: { value: string }) {
  const v = value.toLowerCase()
  let tone: 'ok' | 'warn' | 'bad' | 'muted' = 'muted'
  if (['published', 'active', 'live', 'ok', 'done', 'complete'].includes(v)) tone = 'ok'
  else if (['draft', 'pending', 'review', 'wip'].includes(v)) tone = 'warn'
  else if (['error', 'failed', 'rejected'].includes(v)) tone = 'bad'
  return <Pill tone={tone} dot>{value}</Pill>
}
