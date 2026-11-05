import { useEffect, useRef } from 'react'

export function Thumb({
  data,
  width,
  height,
  className,
}: {
  data: Uint8ClampedArray
  width: number
  height: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  }, [data, width, height])
  return <canvas ref={ref} width={width} height={height} className={className} />
}
