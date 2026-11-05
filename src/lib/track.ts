import { diskCentroid, sampleRgba, type Disk } from './image.ts'

/** Side of the square crop in units of the disk radius. Rings need the extra room. */
export const CROP_FACTOR = 7.6

export type TrackMode = 'zoom' | 'match' | 'all'

export type PlanetSample = {
  time: number
  cx: number
  cy: number
  r: number
  frameW: number
  frameH: number
  missing: boolean
  clipped: boolean
  dark: boolean
  group?: number
}

export type TrackPlan = {
  kept: number[]
  t0: number
  t1: number
  medianR: number
  factor: number
  perFrame: boolean
  normalized: boolean
  note: string
}

export const VIDEO_DECODE_MESSAGE =
  'Der Browser kann dieses Video nicht abspielen. iPhone-Aufnahmen sind oft HEVC mit HDR. Tipp: in der Fotos-App oder einem Schnittprogramm als H.264/SDR exportieren, oder Einzelbilder als JPEG laden.'

export const NO_PLANET_MESSAGE =
  'Kein Bild zeigt den Planeten vollständig. Er liegt am Rand, ist zu klein oder das Bild ist schwarz. Verschiebe Anfang und Ende, oder wähle „Gleich groß“.'

export const READ_FAILURE_MESSAGE =
  'Kein Bild konnte gelesen werden. Der Film ließ sich nicht Bild für Bild öffnen. Tipp: als H.264/SDR exportieren oder Einzelbilder als JPEG laden.'

export const WEAK_ALIGN_MESSAGE =
  'Zu wenige Bilder lassen sich zur Deckung bringen. Bilder ohne sichere Deckung werden nicht trotzdem gestapelt.'

export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function diskIsClipped(disk: Disk, w: number, h: number): boolean {
  const keep = disk.r * 0.82
  return disk.cx < keep || disk.cy < keep || disk.cx > w - 1 - keep || disk.cy > h - 1 - keep
}

export function inspectPlanet(gray: Float32Array, w: number, h: number, time: number): PlanetSample {
  let max = 0
  for (let i = 0; i < gray.length; i++) if ((gray[i] ?? 0) > max) max = gray[i] ?? 0
  const dark = max < 0.025
  const minRadius = Math.max(3.5, Math.min(w, h) * 0.008)
  const disk = diskCentroid(gray, w, h, { minRadius, minContrast: 0.045 })
  if (!disk) {
    return { time, cx: 0, cy: 0, r: 0, frameW: w, frameH: h, missing: true, clipped: false, dark }
  }
  return {
    time,
    cx: disk.cx,
    cy: disk.cy,
    r: disk.r,
    frameW: w,
    frameH: h,
    missing: false,
    clipped: diskIsClipped(disk, w, h),
    dark,
  }
}

export function squareCrop(
  cx: number,
  cy: number,
  side: number,
  w: number,
  h: number,
): { sx: number; sy: number; side: number } | null {
  if (side < 16 || side > w + 1 || side > h + 1) return null
  const sx = cx - side / 2
  const sy = cy - side / 2
  if (sx < -1 || sy < -1 || sx + side > w + 1 || sy + side > h + 1) return null
  const clampedSide = Math.min(side, w, h)
  return {
    sx: Math.max(0, Math.min(sx, w - clampedSide)),
    sy: Math.max(0, Math.min(sy, h - clampedSide)),
    side: clampedSide,
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function stableRuns(samples: PlanetSample[]): PlanetSample[][] {
  const usable = samples.filter((sample) => !sample.missing && !sample.clipped)
  const runs: PlanetSample[][] = []
  let index = 0
  while (index < usable.length) {
    const run = [usable[index]!]
    let lo = usable[index]!.r
    let hi = usable[index]!.r
    let next = index + 1
    while (next < usable.length) {
      const candidate = usable[next]!
      if ((candidate.group ?? 0) !== (run[0]!.group ?? 0)) break
      const gap = candidate.time - usable[next - 1]!.time
      const previousGap = next - 2 >= index ? usable[next - 1]!.time - usable[next - 2]!.time : gap
      if (previousGap > 0 && gap > previousGap * 2.4) break
      const nextLo = Math.min(lo, candidate.r)
      const nextHi = Math.max(hi, candidate.r)
      if (nextLo <= 0 || nextHi / nextLo > 1.22) break
      run.push(candidate)
      lo = nextLo
      hi = nextHi
      next++
    }
    runs.push(run)
    index = Math.max(next, index + 1)
  }
  return runs
}

function fitting(samples: PlanetSample[], side: number): PlanetSample[] {
  return samples.filter((sample) => squareCrop(sample.cx, sample.cy, side, sample.frameW, sample.frameH))
}

function bestFactor(samples: PlanetSample[], radius: number): { factor: number; kept: PlanetSample[] } {
  let chosen = { factor: CROP_FACTOR, kept: [] as PlanetSample[] }
  for (let factor = CROP_FACTOR; factor >= 4.5; factor -= 0.4) {
    const kept = fitting(samples, radius * factor)
    if (kept.length >= 2 && kept.length >= chosen.kept.length) chosen = { factor, kept }
    if (kept.length >= Math.min(6, samples.length) && kept.length >= 2) return { factor, kept }
  }
  return chosen
}

function span(samples: PlanetSample[]): { t0: number; t1: number } {
  const times = samples.map((sample) => sample.time)
  return { t0: Math.min(...times), t1: Math.max(...times) }
}

export function chooseTrack(samples: PlanetSample[], mode: TrackMode): TrackPlan | null {
  const present = samples.filter((sample) => !sample.missing && !sample.clipped)
  if (present.length === 0) return null

  if (mode === 'zoom') {
    const runs = stableRuns(samples).filter((run) => run.length >= 2)
    if (runs.length === 0) return null
    const ranked = runs
      .map((run) => ({ run, radius: median(run.map((sample) => sample.r)), count: run.length }))
      .sort((a, b) => b.radius * Math.sqrt(b.count) - a.radius * Math.sqrt(a.count))
    for (const candidate of ranked) {
      const fitted = bestFactor(candidate.run, candidate.radius)
      if (fitted.kept.length < 2) continue
      const range = span(fitted.kept)
      const dropped = samples.length - fitted.kept.length
      return {
        kept: fitted.kept.map((sample) => samples.indexOf(sample)),
        t0: range.t0,
        t1: range.t1,
        medianR: median(fitted.kept.map((sample) => sample.r)),
        factor: fitted.factor,
        perFrame: false,
        normalized: false,
        note: `${dropped} von ${samples.length} Bildern ohne vollständigen Planeten verworfen. Genommen wird ${clock(range.t0)}–${clock(range.t1)}, dort ist die Scheibe am größten und ähnlich groß.`,
      }
    }
    return null
  }

  if (mode === 'match') {
    let picked: PlanetSample[] = []
    let factor = CROP_FACTOR
    for (let next = CROP_FACTOR; next >= 4.5; next -= 0.4) {
      const kept = present.filter((sample) =>
        squareCrop(sample.cx, sample.cy, sample.r * next, sample.frameW, sample.frameH),
      )
      if (kept.length >= picked.length) {
        picked = kept
        factor = next
      }
      if (kept.length >= Math.min(6, present.length) && kept.length >= 2) {
        picked = kept
        factor = next
        break
      }
    }
    if (picked.length < 2) return null
    const range = span(picked)
    return {
      kept: picked.map((sample) => samples.indexOf(sample)),
      t0: range.t0,
      t1: range.t1,
      medianR: median(picked.map((sample) => sample.r)),
      factor,
      perFrame: true,
      normalized: false,
      note: `${samples.length - picked.length} von ${samples.length} Bildern ohne vollständigen Planeten verworfen. Jede Scheibe wird auf dieselbe Größe gezogen.`,
    }
  }

  const radius = median(present.map((sample) => sample.r))
  const fitted = bestFactor(present, radius)
  if (fitted.kept.length < 2) return null
  const range = span(fitted.kept)
  const ratio =
    Math.max(...present.map((sample) => sample.r)) / Math.max(1e-3, Math.min(...present.map((sample) => sample.r)))
  const scaleNote =
    ratio > 1.35
      ? 'Die Größe schwankt stark. „Großer Zoom“ oder „Gleich groß“ wird meist schärfer.'
      : 'Alle vollständigen Bilder, feste Fenstergröße.'
  return {
    kept: fitted.kept.map((sample) => samples.indexOf(sample)),
    t0: range.t0,
    t1: range.t1,
    medianR: median(fitted.kept.map((sample) => sample.r)),
    factor: fitted.factor,
    perFrame: false,
    normalized: false,
    note: `${samples.length - fitted.kept.length} von ${samples.length} Bildern ohne vollständigen Planeten verworfen. ${scaleNote}`,
  }
}

export function innerSpan(t0: number, t1: number): { t0: number; t1: number } {
  const spanWidth = Math.max(0, t1 - t0)
  const pad = Math.min(spanWidth * 0.08, 0.2)
  if (spanWidth - 2 * pad >= 0.35) return { t0: t0 + pad, t1: t1 - pad }
  return { t0, t1 }
}

export function sampleTimes(t0: number, t1: number, count: number): number[] {
  const n = Math.max(2, Math.round(count))
  const start = Math.min(t0, t1)
  const end = Math.max(t0, t1)
  if (end - start < 1e-3) return [start]
  return Array.from({ length: n }, (_, index) => start + ((index + 0.5) / n) * (end - start))
}

export function resampleCrop(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  side: number,
  out: number,
): Uint8ClampedArray {
  const dest = new Uint8ClampedArray(out * out * 4)
  for (let y = 0; y < out; y++) {
    const fy = sy + ((y + 0.5) * side) / out - 0.5
    for (let x = 0; x < out; x++) {
      const fx = sx + ((x + 0.5) * side) / out - 0.5
      const pixel = sampleRgba(src, w, h, fx, fy)
      if (!pixel) continue
      const offset = (y * out + x) * 4
      dest[offset] = pixel[0]
      dest[offset + 1] = pixel[1]
      dest[offset + 2] = pixel[2]
      dest[offset + 3] = 255
    }
  }
  return dest
}

export const NORMAL = 1000

/** Compare disks from different files by their size relative to the frame. */
export function chooseAcross(groups: PlanetSample[][], mode: TrackMode): TrackPlan | null {
  const flat: PlanetSample[] = []
  groups.forEach((group, groupIndex) => {
    for (const sample of group) {
      const unit = Math.max(1, Math.min(sample.frameW, sample.frameH))
      flat.push({
        ...sample,
        group: groupIndex,
        cx: sample.frameW > 0 ? (sample.cx / sample.frameW) * NORMAL : 0,
        cy: sample.frameH > 0 ? (sample.cy / sample.frameH) * NORMAL : 0,
        r: sample.missing ? 0 : (sample.r / unit) * NORMAL,
        frameW: NORMAL,
        frameH: sample.frameW > 0 ? (sample.frameH / sample.frameW) * NORMAL : NORMAL,
      })
    }
  })
  const plan = chooseTrack(flat, mode)
  if (!plan) return null
  return { ...plan, normalized: true }
}

/**
 * Map flat indexes from chooseAcross back onto each file.
 * The running offset moves only after the lookup, otherwise every index misses.
 */
export function keptByFile<T>(groups: readonly (readonly T[])[], kept: readonly number[]): T[][] {
  const chosen: T[][] = []
  let offset = 0
  for (const group of groups) {
    const base = offset
    offset += group.length
    chosen.push(
      kept
        .filter((index) => index >= base && index < offset)
        .map((index) => group[index - base])
        .filter((sample): sample is T => sample != null),
    )
  }
  return chosen
}

export function cropSidePixels(native: PlanetSample, plan: TrackPlan): number {
  if (plan.perFrame) return native.r * plan.factor
  if (plan.normalized) return (plan.medianR / NORMAL) * Math.min(native.frameW, native.frameH) * plan.factor
  return plan.medianR * plan.factor
}

export function describeSources(rows: { name: string; count: number }[], failures: string[]): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const parts = rows.map((row) => `${row.name} ${row.count}`)
  const head = `${total} Bilder aus ${rows.length} ${rows.length === 1 ? 'Datei' : 'Dateien'}: ${parts.join(', ')}.`
  return failures.length ? `${head} Übersprungen: ${failures.join(' ')}` : head
}
