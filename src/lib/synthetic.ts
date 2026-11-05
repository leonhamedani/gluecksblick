import { gaussianBlur } from './image.ts'
import { sampleGray } from './image.ts'

export type SynthFrameSpec = { dx: number; dy: number; blur: number }

export type SynthSequence = {
  frames: Uint8ClampedArray[]
  w: number
  h: number
  specs: SynthFrameSpec[]
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function renderSharpPlanet(w: number, h: number): Float32Array {
  const rgb = new Float32Array(w * h * 3)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const radius = Math.min(w, h) * 0.34
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / radius
      const ny = (y - cy) / radius
      const r2 = nx * nx + ny * ny
      const i = (y * w + x) * 3
      if (r2 > 1) {
        const sky = 0.02
        rgb[i] = sky * 0.35
        rgb[i + 1] = sky * 0.4
        rgb[i + 2] = sky * 0.55
        continue
      }
      const z = Math.sqrt(1 - r2)
      const band = Math.sin(ny * 11 + Math.sin(nx * 3 + ny * 2) * 0.8)
      const fine = Math.sin(nx * 28 + ny * 3) * Math.sin(ny * 19)
      const sx = nx - 0.32
      const sy = ny - 0.12
      const spot = Math.exp(-(sx * sx * 22 + sy * sy * 36))
      const limb = Math.pow(z, 0.42)
      const r = (0.78 + 0.15 * band - 0.4 * spot + 0.055 * fine) * limb
      const g = (0.5 + 0.1 * band - 0.1 * spot + 0.04 * fine) * limb
      const b = (0.28 + 0.05 * band + 0.02 * fine) * limb
      rgb[i] = Math.min(1, Math.max(0, r))
      rgb[i + 1] = Math.min(1, Math.max(0, g))
      rgb[i + 2] = Math.min(1, Math.max(0, b))
    }
  }
  return rgb
}

function channel(rgb: Float32Array, w: number, h: number, index: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = rgb[i * 3 + index] ?? 0
  return out
}

function blurChannels(rgb: Float32Array, w: number, h: number, sigma: number): [Float32Array, Float32Array, Float32Array] {
  return [0, 1, 2].map((index) => gaussianBlur(channel(rgb, w, h, index), w, h, sigma)) as [
    Float32Array,
    Float32Array,
    Float32Array,
  ]
}

export function rasterShifted(
  channels: [Float32Array, Float32Array, Float32Array],
  w: number,
  h: number,
  dx: number,
  dy: number,
  noise: number,
  rng: () => number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - dx
      const sy = y - dy
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const value = sampleGray(channels[c], w, h, sx, sy)
        const n = Number.isNaN(value) ? 0 : value + (rng() - 0.5) * noise
        out[o + c] = Math.round(Math.min(1, Math.max(0, n)) * 255)
      }
      out[o + 3] = 255
    }
  }
  return out
}

export function makePlanetSequence(options?: {
  w?: number
  h?: number
  count?: number
  seed?: number
}): SynthSequence {
  const w = options?.w ?? 128
  const h = options?.h ?? 128
  const count = options?.count ?? 12
  const rng = mulberry32(options?.seed ?? 11)
  const sharp = renderSharpPlanet(w, h)
  const specs: SynthFrameSpec[] = []
  for (let i = 0; i < count; i++) {
    const crisp = i % 4 === 0
    specs.push({
      dx: (rng() * 2 - 1) * 4.5,
      dy: (rng() * 2 - 1) * 4.5,
      blur: crisp ? 0.2 + rng() * 0.25 : 1.5 + rng() * 1.5,
    })
  }
  const cache = new Map<number, [Float32Array, Float32Array, Float32Array]>()
  const frames = specs.map((spec) => {
    const key = Math.round(spec.blur * 20)
    let blurred = cache.get(key)
    if (!blurred) {
      blurred = blurChannels(sharp, w, h, spec.blur)
      cache.set(key, blurred)
    }
    return rasterShifted(blurred, w, h, spec.dx, spec.dy, 0.012, rng)
  })
  return { frames, w, h, specs }
}
