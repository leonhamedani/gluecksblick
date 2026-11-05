import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.ts'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-line bg-panel-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass data-[state=checked]:border-brass data-[state=checked]:bg-brass',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-6 translate-x-1 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-7 data-[state=checked]:bg-[#1c1408]" />
    </SwitchPrimitive.Root>
  )
}
