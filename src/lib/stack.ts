import { warpRgba } from './image.ts'
import type { FrameShift } from './align.ts'

export type Warper = typeof warpRgba

export function warpFrame(src: Uint8Array | Uint8ClampedArray, w: number, h: number, shift: FrameShift, warp: Warper = warpRgba): Uint8Array {
  return warp(src, w, h, shift.dx, shift.dy, shift.field, shift.fieldW, shift.fieldH, shift.step)
}

export function accumulateMean(sum: Float32Array, count: Float32Array, rgba: Uint8Array): void {
  const pixels = count.length
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    if ((rgba[p + 3] ?? 0) === 0) continue
    sum[i * 3] += (rgba[p] ?? 0) / 255
    sum[i * 3 + 1] += (rgba[p + 1] ?? 0) / 255
    sum[i * 3 + 2] += (rgba[p + 2] ?? 0) / 255
    count[i]++
  }
}

export function finalizeMean(sum: Float32Array, count: Float32Array): Float32Array {
  const out = new Float32Array(sum.length)
  for (let i = 0; i < count.length; i++) {
    const n = count[i] ?? 0
    if (n <= 0) continue
    out[i * 3] = (sum[i * 3] ?? 0) / n
    out[i * 3 + 1] = (sum[i * 3 + 1] ?? 0) / n
    out[i * 3 + 2] = (sum[i * 3 + 2] ?? 0) / n
  }
  return out
}

export function sigmaClip(frames: Uint8Array[], w: number, h: number, kappa: number): Float32Array {
  const pixels = w * h
  const sumL = new Float64Array(pixels)
  const sumL2 = new Float64Array(pixels)
  const count = new Float64Array(pixels)
  const sumR = new Float64Array(pixels)
  const sumG = new Float64Array(pixels)
  const sumB = new Float64Array(pixels)

  const read = (frame: Uint8Array, p: number) => {
    const r = (frame[p] ?? 0) / 255
    const g = (frame[p + 1] ?? 0) / 255
    const b = (frame[p + 2] ?? 0) / 255
    return { r, g, b, L: 0.2126 * r + 0.7152 * g + 0.0722 * b }
  }

  for (const frame of frames) {
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
      if ((frame[p + 3] ?? 0) === 0) continue
      const sample = read(frame, p)
      sumL[i] += sample.L
      sumL2[i] += sample.L * sample.L
      sumR[i] += sample.r
      sumG[i] += sample.g
      sumB[i] += sample.b
      count[i]++
    }
  }

  const out = new Float32Array(pixels * 3)
  const outCount = new Float64Array(pixels)
  for (const frame of frames) {
    for (let i = 0, p = 0; i < pixels; i++, p += 4) {
      const n = count[i] ?? 0
      if ((frame[p + 3] ?? 0) === 0 || n < 1) continue
      const sample = read(frame, p)
      const meanL = (sumL[i] ?? 0) / n
      const variance = Math.max(0, (sumL2[i] ?? 0) / n - meanL * meanL)
      const std = Math.sqrt(variance)
      if (n >= 3 && std > 1 / 255 && Math.abs(sample.L - meanL) > kappa * std) continue
      out[i * 3] += sample.r
      out[i * 3 + 1] += sample.g
      out[i * 3 + 2] += sample.b
      outCount[i]++
    }
  }

  for (let i = 0; i < pixels; i++) {
    const n = outCount[i] ?? 0
    if (n > 0) {
      out[i * 3] /= n
      out[i * 3 + 1] /= n
      out[i * 3 + 2] /= n
    } else if ((count[i] ?? 0) > 0) {
      const nAll = count[i] ?? 1
      out[i * 3] = (sumR[i] ?? 0) / nAll
      out[i * 3 + 1] = (sumG[i] ?? 0) / nAll
      out[i * 3 + 2] = (sumB[i] ?? 0) / nAll
    }
  }
  return out
}

export function stackWarped(frames: Uint8Array[], w: number, h: number, mode: 'mean' | 'sigma', kappa: number): Float32Array {
  if (mode === 'sigma') return sigmaClip(frames, w, h, kappa)
  const sum = new Float32Array(w * h * 3)
  const count = new Float32Array(w * h)
  for (const frame of frames) accumulateMean(sum, count, frame)
  return finalizeMean(sum, count)
}
