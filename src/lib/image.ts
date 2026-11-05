import { fft2 } from './fft.ts'

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function rgbaToGrayU8(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const pixels = rgba.length / 4
  const gray = new Uint8Array(pixels)
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    gray[i] = Math.round(0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2])
  }
  return gray
}

export function grayU8ToFloat(gray: Uint8Array): Float32Array {
  const out = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] / 255
  return out
}

export function luminanceOfRgb(rgb: Float32Array): Float32Array {
  const out = new Float32Array(rgb.length / 3)
  for (let i = 0, p = 0; i < out.length; i++, p += 3) {
    out[i] = 0.2126 * rgb[p] + 0.7152 * rgb[p + 1] + 0.0722 * rgb[p + 2]
  }
  return out
}

/** Outside the frame the sample is NaN, so stacking can ignore the border. */
export function sampleGray(src: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return Number.NaN
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = x - x0
  const ty = y - y0
  const i00 = src[y0 * w + x0]
  const i10 = src[y0 * w + x1]
  const i01 = src[y1 * w + x0]
  const i11 = src[y1 * w + x1]
  return (i00 * (1 - tx) + i10 * tx) * (1 - ty) + (i01 * (1 - tx) + i11 * tx) * ty
}

export function sampleRgba(
  src: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = x - x0
  const ty = y - y0
  const p00 = (y0 * w + x0) * 4
  const p10 = (y0 * w + x1) * 4
  const p01 = (y1 * w + x0) * 4
  const p11 = (y1 * w + x1) * 4
  const mix = (channel: number) =>
    Math.round(
      (src[p00 + channel] * (1 - tx) + src[p10 + channel] * tx) * (1 - ty) +
        (src[p01 + channel] * (1 - tx) + src[p11 + channel] * tx) * ty,
    )
  return [mix(0), mix(1), mix(2)]
}

export function downsample(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  if (sw === dw && sh === dh) return src.slice()
  const out = new Float32Array(dw * dh)
  const scaleX = sw / dw
  const scaleY = sh / dh
  for (let y = 0; y < dh; y++) {
    const y0 = y * scaleY
    const y1 = (y + 1) * scaleY
    const iy0 = Math.floor(y0)
    const iy1 = Math.min(sh, Math.max(iy0 + 1, Math.ceil(y1)))
    for (let x = 0; x < dw; x++) {
      const x0 = x * scaleX
      const x1 = (x + 1) * scaleX
      const ix0 = Math.floor(x0)
      const ix1 = Math.min(sw, Math.max(ix0 + 1, Math.ceil(x1)))
      let acc = 0
      let n = 0
      for (let yy = iy0; yy < iy1; yy++) {
        const row = yy * sw
        for (let xx = ix0; xx < ix1; xx++) {
          acc += src[row + xx]
          n++
        }
      }
      out[y * dw + x] = n ? acc / n : 0
    }
  }
  return out
}

export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.15) return src.slice()
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float64Array(radius * 2 + 1)
  let weight = 0
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = value
    weight += value
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= weight

  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i))
        acc += src[y * w + xx] * kernel[i + radius]
      }
      tmp[y * w + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i))
        acc += tmp[yy * w + x] * kernel[i + radius]
      }
      out[y * w + x] = acc
    }
  }
  return out
}

export function focusScore(gray: Float32Array, w: number, h: number): number {
  const blurred = gaussianBlur(gray, w, h, 0.8)
  let sum = 0
  let sum2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap =
        4 * blurred[i] - blurred[i - 1] - blurred[i + 1] - blurred[i - w] - blurred[i + w]
      sum += lap
      sum2 += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sum2 / n - mean * mean
}

export function scoreGrayU8(gray: Uint8Array, w: number, h: number): number {
  return focusScore(grayU8ToFloat(gray), w, h)
}

export function variance(data: Float32Array): number {
  let sum = 0
  let sum2 = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]
    sum2 += data[i] * data[i]
  }
  const mean = sum / data.length
  return sum2 / data.length - mean * mean
}

export function borderMedian(gray: Float32Array, w: number, h: number): number {
  const samples: number[] = []
  const stepX = Math.max(1, Math.floor(w / 16))
  const stepY = Math.max(1, Math.floor(h / 16))
  for (let x = 0; x < w; x += stepX) {
    samples.push(gray[x] ?? 0)
    samples.push(gray[(h - 1) * w + x] ?? 0)
  }
  for (let y = 0; y < h; y += stepY) {
    samples.push(gray[y * w] ?? 0)
    samples.push(gray[y * w + w - 1] ?? 0)
  }
  samples.sort((a, b) => a - b)
  return samples[samples.length >> 1] ?? 0
}

export type Disk = { cx: number; cy: number; r: number }

export function diskCentroid(
  gray: Float32Array,
  w: number,
  h: number,
  options?: { minRadius?: number; minContrast?: number },
): Disk | null {
  const minRadius = options?.minRadius ?? 6
  const minContrast = options?.minContrast ?? 0.08
  const bg = borderMedian(gray, w, h)
  let max = 0
  for (let i = 0; i < gray.length; i++) if (gray[i] > max) max = gray[i]
  if (max - bg < minContrast) return null
  const threshold = bg + 0.28 * (max - bg)
  let sum = 0
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = gray[y * w + x] ?? 0
      if (value <= threshold) continue
      const weight = value - bg
      sum += weight
      sx += x * weight
      sy += y * weight
      n++
    }
  }
  if (sum <= 0 || n < 20) return null
  const radius = Math.sqrt(n / Math.PI)
  if (radius < minRadius) return null
  return { cx: sx / sum, cy: sy / sum, r: radius }
}

/** Lifts washed-out HDR frames. Dark telescope skies are left alone. */
export function stretchIfNeeded(rgba: Uint8ClampedArray, w: number, h: number): boolean {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 8000)))
  const border: number[] = []
  let max = 0
  const sample = (x: number, y: number) => {
    const p = (y * w + x) * 4
    return (0.2126 * (rgba[p] ?? 0) + 0.7152 * (rgba[p + 1] ?? 0) + 0.0722 * (rgba[p + 2] ?? 0)) / 255
  }
  for (let x = 0; x < w; x += step) {
    border.push(sample(x, 0), sample(x, h - 1))
  }
  for (let y = 0; y < h; y += step) {
    border.push(sample(0, y), sample(w - 1, y))
  }
  for (let y = 0; y < h; y += step * 2) {
    for (let x = 0; x < w; x += step * 2) {
      const value = sample(x, y)
      if (value > max) max = value
    }
  }
  border.sort((a, b) => a - b)
  const bg = border[border.length >> 1] ?? 0
  if (bg < 0.1 && max - bg > 0.22) return false
  if (max - bg < 0.04) return false
  const black = bg
  const white = Math.max(max, bg + 0.05)
  const scale = 255 / (white - black)
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const lifted = ((rgba[i + c] ?? 0) / 255 - black) * scale
      rgba[i + c] = Math.max(0, Math.min(255, Math.round(lifted)))
    }
  }
  return true
}

export function embedCentered(src: Float32Array, sw: number, sh: number, side: number): Float32Array {
  if (sw === side && sh === side) return src.slice()
  const out = new Float32Array(side * side)
  const ox = Math.floor((side - sw) / 2)
  const oy = Math.floor((side - sh) / 2)
  for (let y = 0; y < sh; y++) {
    out.set(src.subarray(y * sw, y * sw + sw), (y + oy) * side + ox)
  }
  return out
}

export function extractWindow(
  src: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  side: number,
): Float32Array {
  const out = new Float32Array(side * side)
  const x0 = cx - (side - 1) / 2
  const y0 = cy - (side - 1) / 2
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const value = sampleGray(src, w, h, x0 + x, y0 + y)
      out[y * side + x] = Number.isNaN(value) ? 0 : value
    }
  }
  return out
}

export type ShiftEstimate = { dx: number; dy: number; peak: number }

function windowed(src: Float32Array, size: number): Float64Array {
  let sum = 0
  for (let i = 0; i < src.length; i++) sum += src[i]
  const mean = sum / src.length
  const out = new Float64Array(size * size)
  const denom = Math.max(1, size - 1)
  for (let y = 0; y < size; y++) {
    const wy = 0.5 * (1 - Math.cos((2 * Math.PI * y) / denom))
    for (let x = 0; x < size; x++) {
      const wx = 0.5 * (1 - Math.cos((2 * Math.PI * x) / denom))
      out[y * size + x] = (src[y * size + x] - mean) * wx * wy
    }
  }
  return out
}

function subpixel(corr: Float64Array, size: number, x: number, y: number, horizontal: boolean): number {
  const at = (xx: number, yy: number) => corr[((yy + size) % size) * size + ((xx + size) % size)]
  const mid = at(x, y)
  const left = horizontal ? at(x - 1, y) : at(x, y - 1)
  const right = horizontal ? at(x + 1, y) : at(x, y + 1)
  const denom = left - 2 * mid + right
  let delta = 0
  if (Math.abs(denom) > 1e-9) delta = (0.5 * (left - right)) / denom
  delta = Math.min(0.5, Math.max(-0.5, delta))
  let index = horizontal ? x : y
  if (index >= size / 2) index -= size
  return index + delta
}

/** Phase correlation on a square buffer. Peak near 1 means a confident match. */
export function phaseCorrelate(a: Float32Array, b: Float32Array, size: number): ShiftEstimate {
  const reA = windowed(a, size)
  const imA = new Float64Array(size * size)
  const reB = windowed(b, size)
  const imB = new Float64Array(size * size)
  fft2(reA, imA, size, size, false)
  fft2(reB, imB, size, size, false)
  const n = size * size
  for (let i = 0; i < n; i++) {
    const ar = reA[i]
    const ai = imA[i]
    const br = reB[i]
    const bi = imB[i]
    const cr = ar * br + ai * bi
    const ci = ai * br - ar * bi
    const mag = Math.hypot(cr, ci)
    if (mag < 1e-12) {
      reA[i] = 0
      imA[i] = 0
    } else {
      reA[i] = cr / mag
      imA[i] = ci / mag
    }
  }
  fft2(reA, imA, size, size, true)
  let best = 0
  let bestValue = -Infinity
  for (let i = 0; i < n; i++) {
    if (reA[i] > bestValue) {
      bestValue = reA[i]
      best = i
    }
  }
  const x = best % size
  const y = (best / size) | 0
  // The FFT peak sits opposite the sample offset: output(x, y) reads frame(x + dx, y + dy).
  return {
    dx: -subpixel(reA, size, x, y, true),
    dy: -subpixel(reA, size, x, y, false),
    peak: bestValue,
  }
}

export function sampleField(
  field: Float32Array,
  fw: number,
  fh: number,
  step: number,
  x: number,
  y: number,
): [number, number] {
  if (fw <= 0 || fh <= 0 || step <= 0) return [0, 0]
  const fx = Math.min(fw - 1, Math.max(0, x / step - 0.5))
  const fy = Math.min(fh - 1, Math.max(0, y / step - 0.5))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, fw - 1)
  const y1 = Math.min(y0 + 1, fh - 1)
  const tx = fx - x0
  const ty = fy - y0
  const at = (ix: number, iy: number) => {
    const i = (iy * fw + ix) * 2
    return [field[i] ?? 0, field[i + 1] ?? 0] as const
  }
  const a = at(x0, y0)
  const b = at(x1, y0)
  const c = at(x0, y1)
  const d = at(x1, y1)
  const dx = (a[0] * (1 - tx) + b[0] * tx) * (1 - ty) + (c[0] * (1 - tx) + d[0] * tx) * ty
  const dy = (a[1] * (1 - tx) + b[1] * tx) * (1 - ty) + (c[1] * (1 - tx) + d[1] * tx) * ty
  return [dx, dy]
}

/**
 * dx/dy move the sample point: output(x, y) reads the source at (x+dx, y+dy).
 * A positive dx pulls content that sits to the right back onto the reference.
 */
export function warpRgba(
  src: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  dx: number,
  dy: number,
  field: Float32Array | null,
  fw: number,
  fh: number,
  step: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rdx = 0
      let rdy = 0
      if (field && fw > 0 && fh > 0) {
        const shift = sampleField(field, fw, fh, step, x, y)
        rdx = shift[0]
        rdy = shift[1]
      }
      const pixel = sampleRgba(src, w, h, x + dx + rdx, y + dy + rdy)
      if (!pixel) continue
      const o = (y * w + x) * 4
      out[o] = pixel[0]
      out[o + 1] = pixel[1]
      out[o + 2] = pixel[2]
      out[o + 3] = 255
    }
  }
  return out
}

export function warpGray(src: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = sampleGray(src, w, h, x + dx, y + dy)
    }
  }
  return out
}
