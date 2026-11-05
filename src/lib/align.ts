import { nextPow2 } from './fft.ts'
import {
  diskCentroid,
  downsample,
  embedCentered,
  extractWindow,
  grayU8ToFloat,
  phaseCorrelate,
  type Disk,
  type ShiftEstimate,
  variance,
  warpGray,
} from './image.ts'

/** Global correlation is done at this size so phones stay responsive. */
const FFT_LIMIT = 256

export type Motive = 'planet' | 'surface'
export type ReferenceMode = 'best' | 'average'

export type ProcessOptions = {
  motive: Motive
  reference: ReferenceMode
  localGrid: number
  patchSize: number
  minPeak: number
  minLocalPeak: number
  stackMode: 'mean' | 'sigma'
  sigmaKappa: number
}

export type FrameShift = {
  index: number
  dx: number
  dy: number
  peak: number
  rejected: boolean
  field: Float32Array | null
  fieldW: number
  fieldH: number
  step: number
  localValid: number
  localTotal: number
}

export type AlignResult = {
  shifts: FrameShift[]
  kept: number[]
}

export const FIELD_STEP = 8

export function keepIndices(scores: number[], ratio: number): number[] {
  if (scores.length === 0) return []
  const clamped = Math.min(1, Math.max(0.02, ratio))
  const count = Math.max(1, Math.min(scores.length, Math.round(scores.length * clamped)))
  const order = scores.map((score, index) => ({ score, index }))
  order.sort((a, b) => b.score - a.score || a.index - b.index)
  return order
    .slice(0, count)
    .map((item) => item.index)
    .sort((a, b) => a - b)
}

function correlateFull(ref: Float32Array, mov: Float32Array, w: number, h: number): ShiftEstimate {
  const scale = Math.min(1, FFT_LIMIT / Math.max(w, h))
  const cw = Math.max(16, Math.round(w * scale))
  const ch = Math.max(16, Math.round(h * scale))
  const smallA = downsample(ref, w, h, cw, ch)
  const smallB = downsample(mov, w, h, cw, ch)
  const side = nextPow2(Math.max(cw, ch))
  const corr = phaseCorrelate(embedCentered(smallA, cw, ch, side), embedCentered(smallB, cw, ch, side), side)
  return { dx: corr.dx / (cw / w), dy: corr.dy / (ch / h), peak: corr.peak }
}

/**
 * dx/dy are sample offsets. The aligned pixel (x, y) is read from the moving
 * frame at (x + dx, y + dy).
 */
export function globalShift(
  ref: Float32Array,
  mov: Float32Array,
  w: number,
  h: number,
  motive: Motive,
): ShiftEstimate {
  if (motive === 'planet') {
    const a = diskCentroid(ref, w, h, { minRadius: 4, minContrast: 0.05 })
    const b = diskCentroid(mov, w, h, { minRadius: 4, minContrast: 0.05 })
    if (!a || !b) return { dx: 0, dy: 0, peak: 0 }
    const radius = Math.max(a.r, b.r)
    const crop = Math.max(32, Math.min(FFT_LIMIT, Math.round(radius * 2.8)))
    const side = nextPow2(crop)
    const residual = phaseCorrelate(
      extractWindow(ref, w, h, a.cx, a.cy, side),
      extractWindow(mov, w, h, b.cx, b.cy, side),
      side,
    )
    return {
      dx: b.cx - a.cx + residual.dx,
      dy: b.cy - a.cy + residual.dy,
      peak: residual.peak,
    }
  }
  return correlateFull(ref, mov, w, h)
}

export type LocalPoint = {
  x: number
  y: number
  dx: number
  dy: number
  peak: number
  valid: boolean
}

export function gridPoints(
  w: number,
  h: number,
  n: number,
  disk: Disk | null,
  patch: number,
): { x: number; y: number }[] {
  const count = Math.max(1, Math.round(n))
  if (disk && disk.r > patch * 0.6 && disk.r < Math.min(w, h) * 0.7) {
    const reach = Math.max(4, disk.r - patch * 0.3)
    if (count === 1) return [{ x: disk.cx, y: disk.cy }]
    const points: { x: number; y: number }[] = []
    for (let j = 0; j < count; j++) {
      for (let i = 0; i < count; i++) {
        const nx = (i / (count - 1)) * 2 - 1
        const ny = (j / (count - 1)) * 2 - 1
        if (nx * nx + ny * ny > 1) continue
        points.push({ x: disk.cx + nx * reach, y: disk.cy + ny * reach })
      }
    }
    if (points.length > 0) return points
  }
  const margin = Math.min(patch / 2, w / 5, h / 5)
  const points: { x: number; y: number }[] = []
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      points.push({
        x: margin + ((i + 0.5) * (w - 2 * margin)) / count,
        y: margin + ((j + 0.5) * (h - 2 * margin)) / count,
      })
    }
  }
  return points
}

export function estimateLocal(
  ref: Float32Array,
  mov: Float32Array,
  w: number,
  h: number,
  points: { x: number; y: number }[],
  patch: number,
  globalDx: number,
  globalDy: number,
  minPeak: number,
): LocalPoint[] {
  const side = nextPow2(Math.max(16, patch))
  return points.map((point) => {
    const refPatch = embedCentered(
      extractWindow(ref, w, h, point.x, point.y, patch),
      patch,
      patch,
      side,
    )
    const movPatch = embedCentered(
      extractWindow(mov, w, h, point.x + globalDx, point.y + globalDy, patch),
      patch,
      patch,
      side,
    )
    if (variance(refPatch) < 0.00035) {
      return { x: point.x, y: point.y, dx: 0, dy: 0, peak: 0, valid: false }
    }
    const corr = phaseCorrelate(refPatch, movPatch, side)
    const valid = corr.peak >= minPeak && Math.hypot(corr.dx, corr.dy) <= patch * 0.45
    return {
      x: point.x,
      y: point.y,
      dx: valid ? corr.dx : 0,
      dy: valid ? corr.dy : 0,
      peak: corr.peak,
      valid,
    }
  })
}

function nearestSpacing(points: LocalPoint[]): number {
  if (points.length < 2) return 48
  let sum = 0
  for (const point of points) {
    let best = Infinity
    for (const other of points) {
      if (other === point) continue
      best = Math.min(best, Math.hypot(point.x - other.x, point.y - other.y))
    }
    sum += best
  }
  return sum / points.length
}

export function buildShiftField(
  w: number,
  h: number,
  points: LocalPoint[],
): { data: Float32Array; fw: number; fh: number; step: number } | null {
  const valid = points.filter((point) => point.valid)
  if (valid.length === 0) return null
  const step = FIELD_STEP
  const fw = Math.ceil(w / step)
  const fh = Math.ceil(h / step)
  const data = new Float32Array(fw * fh * 2)
  const radius = Math.max(16, nearestSpacing(valid) * 1.7)
  const radius2 = radius * radius
  for (let gy = 0; gy < fh; gy++) {
    for (let gx = 0; gx < fw; gx++) {
      const x = (gx + 0.5) * step
      const y = (gy + 0.5) * step
      let weightSum = 0
      let sdx = 0
      let sdy = 0
      for (const point of valid) {
        const ddx = x - point.x
        const ddy = y - point.y
        const dist2 = ddx * ddx + ddy * ddy
        if (dist2 > radius2) continue
        const weight = 1 / (dist2 + 36)
        weightSum += weight
        sdx += weight * point.dx
        sdy += weight * point.dy
      }
      const i = (gy * fw + gx) * 2
      if (weightSum > 0) {
        data[i] = sdx / weightSum
        data[i + 1] = sdy / weightSum
      }
    }
  }
  return { data, fw, fh, step }
}

function averageReference(
  grays: Uint8Array[],
  w: number,
  h: number,
  kept: number[],
  scores: number[],
  shifts: ShiftEstimate[],
  minPeak: number,
): Float32Array {
  const ranked = kept
    .map((index, order) => ({ index, order, score: scores[index] ?? 0, peak: shifts[order]?.peak ?? 0 }))
    .sort((a, b) => b.score - a.score)
  const take = Math.min(ranked.length, Math.max(3, Math.round(ranked.length * 0.12)))
  const acc = new Float32Array(w * h)
  const count = new Float32Array(w * h)
  const bestScore = ranked[0]?.score ?? 0
  for (let k = 0; k < take; k++) {
    const item = ranked[k]
    if (!item) continue
    if (item.peak < minPeak && item.score < bestScore) continue
    const shift = shifts[item.order] ?? { dx: 0, dy: 0, peak: 0 }
    const gray = grayU8ToFloat(grays[item.index] ?? new Uint8Array(w * h))
    const warped = Math.abs(shift.dx) < 1e-4 && Math.abs(shift.dy) < 1e-4 ? gray : warpGray(gray, w, h, shift.dx, shift.dy)
    for (let p = 0; p < acc.length; p++) {
      const value = warped[p] ?? Number.NaN
      if (Number.isNaN(value)) continue
      acc[p] += value
      count[p]++
    }
  }
  const avg = new Float32Array(w * h)
  for (let p = 0; p < avg.length; p++) avg[p] = count[p] > 0 ? acc[p] / count[p] : 0
  return avg
}

export function alignKept(
  grays: Uint8Array[],
  w: number,
  h: number,
  kept: number[],
  scores: number[],
  opts: ProcessOptions,
  onProgress?: (ratio: number, label: string) => void,
): AlignResult {
  if (kept.length === 0) return { shifts: [], kept }
  const best = kept.reduce((a, b) => ((scores[b] ?? 0) > (scores[a] ?? 0) ? b : a))
  const ref0 = grayU8ToFloat(grays[best] ?? new Uint8Array(w * h))
  const passes = (opts.reference === 'average' ? 2 : 1) + (opts.localGrid > 0 ? 1 : 0)
  let step = 0
  const report = (label: string) => {
    step++
    onProgress?.(Math.min(1, step / (kept.length * passes)), label)
  }

  const tame = (shift: ShiftEstimate): ShiftEstimate => {
    if (opts.motive === 'planet' && shift.peak > 0 && shift.peak < opts.minPeak) {
      return { dx: 0, dy: 0, peak: shift.peak }
    }
    return shift
  }
  const first: ShiftEstimate[] = []
  for (const index of kept) {
    if (index === best) first.push({ dx: 0, dy: 0, peak: 1 })
    else first.push(tame(globalShift(ref0, grayU8ToFloat(grays[index] ?? new Uint8Array(w * h)), w, h, opts.motive)))
    report('Globale Ausrichtung')
  }

  let reference = ref0
  let global = first
  if (opts.reference === 'average') {
    reference = averageReference(grays, w, h, kept, scores, first, opts.minPeak)
    global = []
    for (const index of kept) {
      global.push(tame(globalShift(reference, grayU8ToFloat(grays[index] ?? new Uint8Array(w * h)), w, h, opts.motive)))
      report('Referenz aus den besten Bildern')
    }
  }

  const disk = opts.motive === 'planet' ? diskCentroid(reference, w, h) : null
  const anchors = opts.localGrid > 0 ? gridPoints(w, h, opts.localGrid, disk, opts.patchSize) : []
  const peakMax = global.reduce((max, item) => Math.max(max, item.peak), 0)
  const shifts: FrameShift[] = []

  for (let i = 0; i < kept.length; i++) {
    const g = global[i] ?? { dx: 0, dy: 0, peak: 0 }
    const tooFar = Math.abs(g.dx) > w * 0.48 || Math.abs(g.dy) > h * 0.48
    const trustedCrop = opts.motive === 'planet' && g.peak > 0 && g.peak < opts.minPeak && g.dx === 0 && g.dy === 0
    const weak = g.peak < opts.minPeak && g.peak < peakMax - 1e-6
    const rejected = g.peak <= 0 || tooFar || (weak && !trustedCrop)
    let field: Float32Array | null = null
    let fieldW = 0
    let fieldH = 0
    let fieldStep = FIELD_STEP
    let localValid = 0
    const localTotal = anchors.length
    if (anchors.length > 0 && !rejected && g.peak >= opts.minPeak) {
      const local = estimateLocal(
        reference,
        grayU8ToFloat(grays[kept[i] ?? 0] ?? new Uint8Array(w * h)),
        w,
        h,
        anchors,
        opts.patchSize,
        g.dx,
        g.dy,
        opts.minLocalPeak,
      )
      localValid = local.filter((point) => point.valid).length
      const built = buildShiftField(w, h, local)
      if (built) {
        field = built.data
        fieldW = built.fw
        fieldH = built.fh
        fieldStep = built.step
      }
    }
    if (anchors.length > 0) report('Lokale Punkte')
    shifts.push({
      index: kept[i] ?? 0,
      dx: g.dx,
      dy: g.dy,
      peak: g.peak,
      rejected,
      field,
      fieldW,
      fieldH,
      step: fieldStep,
      localValid,
      localTotal,
    })
  }

  return { shifts, kept }
}
