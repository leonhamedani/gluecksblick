import { gaussianBlur } from './image.ts'

export type EnhanceSettings = {
  fine: number
  mid: number
  coarse: number
  unsharpAmount: number
  unsharpRadius: number
  brightness: number
  contrast: number
  gamma: number
}

export const gentleEnhance: EnhanceSettings = {
  fine: 0.7,
  mid: 0.4,
  coarse: 0.12,
  unsharpAmount: 0.65,
  unsharpRadius: 1.3,
  brightness: 0.03,
  contrast: 1.12,
  gamma: 0.92,
}

function atrous(src: Float32Array, w: number, h: number, step: number): Float32Array {
  const kernel = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -2; i <= 2; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i * step))
        acc += (src[y * w + xx] ?? 0) * (kernel[i + 2] ?? 0)
      }
      tmp[y * w + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -2; i <= 2; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i * step))
        acc += (tmp[yy * w + x] ?? 0) * (kernel[i + 2] ?? 0)
      }
      out[y * w + x] = acc
    }
  }
  return out
}

export function enhanceImage(rgb: Float32Array, w: number, h: number, settings: EnhanceSettings): Float32Array {
  const y = new Float32Array(w * h)
  for (let i = 0, p = 0; i < y.length; i++, p += 3) {
    y[i] = 0.2126 * (rgb[p] ?? 0) + 0.7152 * (rgb[p + 1] ?? 0) + 0.0722 * (rgb[p + 2] ?? 0)
  }
  const delta = new Float32Array(y.length)
  if (Math.abs(settings.fine) + Math.abs(settings.mid) + Math.abs(settings.coarse) > 0.001) {
    const c1 = atrous(y, w, h, 1)
    const c2 = atrous(c1, w, h, 2)
    const c3 = atrous(c2, w, h, 4)
    for (let i = 0; i < y.length; i++) {
      const w1 = (y[i] ?? 0) - (c1[i] ?? 0)
      const w2 = (c1[i] ?? 0) - (c2[i] ?? 0)
      const w3 = (c2[i] ?? 0) - (c3[i] ?? 0)
      delta[i] = settings.fine * w1 + settings.mid * w2 + settings.coarse * w3
    }
  }
  if (settings.unsharpAmount > 0.001) {
    const blur = gaussianBlur(y, w, h, Math.max(0.4, settings.unsharpRadius))
    for (let i = 0; i < y.length; i++) {
      delta[i] += settings.unsharpAmount * ((y[i] ?? 0) - (blur[i] ?? 0))
    }
  }

  const out = new Float32Array(rgb.length)
  const gamma = Math.max(0.05, settings.gamma)
  for (let i = 0; i < y.length; i++) {
    const p = i * 3
    for (let c = 0; c < 3; c++) {
      let value = (rgb[p + c] ?? 0) + (delta[i] ?? 0)
      value = (value - 0.5) * settings.contrast + 0.5 + settings.brightness
      value = Math.min(1, Math.max(0, value))
      out[p + c] = Math.pow(value, gamma)
    }
  }
  return out
}

export function floatRgbToRgba(rgb: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4)
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    out[p] = Math.round(Math.min(1, Math.max(0, rgb[i] ?? 0)) * 255)
    out[p + 1] = Math.round(Math.min(1, Math.max(0, rgb[i + 1] ?? 0)) * 255)
    out[p + 2] = Math.round(Math.min(1, Math.max(0, rgb[i + 2] ?? 0)) * 255)
    out[p + 3] = 255
  }
  return out
}
