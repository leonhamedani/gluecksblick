import { cn } from '../lib/utils.ts'
import { InfoTip } from './InfoTip.tsx'

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  info,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  info?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        {info ? <InfoTip title={label} body={info} /> : null}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn('grid gap-1 rounded-xl bg-panel-2 p-1', options.length > 2 ? 'grid-cols-3' : 'grid-cols-2')}
      >
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'min-h-11 rounded-lg px-2 text-sm font-medium',
                active ? 'bg-brass text-[#1c1408]' : 'text-muted',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
