// The silo "barrel" glyph (ellipse-stack), redrawn from the design handoff.
export function SiloMark({ size = 16, stroke = 'var(--accent-ink)' }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth={1.3}>
      <ellipse cx="8" cy="4" rx="4.6" ry="1.7" />
      <path d="M3.4 4v7.8c0 .95 2.06 1.7 4.6 1.7s4.6-.75 4.6-1.7V4" />
      <path d="M3.4 7.9c0 .95 2.06 1.7 4.6 1.7s4.6-.75 4.6-1.7" />
    </svg>
  )
}
