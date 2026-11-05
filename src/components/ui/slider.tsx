import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.ts'

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex w-full touch-none items-center select-none data-disabled:opacity-40', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-brass" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-7 rounded-full border-2 border-[#1c1408] bg-brass shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass" />
    </SliderPrimitive.Root>
  )
}
