import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip.tsx'

export function Field({
  label,
  value,
  hint,
  info,
  children,
}: {
  label: string
  value: string
  hint?: string
  info?: string
  children: ReactNode
}) {
  return (
    <div className="block space-y-2">
      <span className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-ink">{label}</span>
          {info ? <InfoTip title={label} body={info} /> : null}
        </span>
        <span className="font-medium text-brass tabular-nums">{value}</span>
      </span>
      {children}
      {hint ? <span className="block text-xs leading-relaxed text-dim">{hint}</span> : null}
    </div>
  )
}
