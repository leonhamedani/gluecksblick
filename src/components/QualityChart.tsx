import { useEffect, useRef } from 'react'
import { keepIndices } from '../lib/align.ts'

export function QualityChart({ scores, keepRatio }: { scores: number[]; keepRatio: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const draw = () => {
      const cssW = canvas.clientWidth || 320
      const cssH = 148
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, cssW, cssH)
      const max = Math.max(...scores, 1e-8)
      const kept = new Set(keepIndices(scores, keepRatio))
      const slot = cssW / Math.max(1, scores.length)
      const gap = scores.length > 70 ? 0 : 1
      scores.forEach((score, index) => {
        const barH = Math.max(2, (score / max) * (cssH - 10))
        context.fillStyle = kept.has(index) ? '#e2a84a' : '#3c4234'
        context.fillRect(index * slot + gap / 2, cssH - barH, Math.max(1, slot - gap), barH)
      })
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [scores, keepRatio])

  return (
    <canvas
      ref={ref}
      className="h-[148px] w-full rounded-xl bg-panel"
      role="img"
      aria-label="Schärfeverlauf der Bilder, Messing steht für behaltene Bilder"
    />
  )
}
