import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from './Button'

export function CopyButton({
  text,
  variant = 'ghost',
  label = 'Copy',
}: {
  text: string
  variant?: 'ghost' | 'accent' | 'outline'
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant={variant === 'accent' ? 'primary' : 'secondary'}
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </Button>
  )
}
