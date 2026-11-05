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
  saturation: number
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
  // Stapeln und der leichte Auto-Schliff ziehen die Farbe Richtung Grau.
  // 1,25 holt ein blasses Gelb zurück, ohne Jupiter-Bänder zu übersteuern.
  saturation: 1.25,
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
  const saturation = Number.isFinite(settings.saturation) ? settings.saturation : 1
  for (let i = 0; i < y.length; i++) {
    const p = i * 3
    let r = (rgb[p] ?? 0) + (delta[i] ?? 0)
    let g = (rgb[p + 1] ?? 0) + (delta[i] ?? 0)
    let b = (rgb[p + 2] ?? 0) + (delta[i] ?? 0)
    r = (r - 0.5) * settings.contrast + 0.5 + settings.brightness
    g = (g - 0.5) * settings.contrast + 0.5 + settings.brightness
    b = (b - 0.5) * settings.contrast + 0.5 + settings.brightness
    r = Math.pow(Math.min(1, Math.max(0, r)), gamma)
    g = Math.pow(Math.min(1, Math.max(0, g)), gamma)
    b = Math.pow(Math.min(1, Math.max(0, b)), gamma)
    if (saturation !== 1) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = Math.min(1, Math.max(0, luma + saturation * (r - luma)))
      g = Math.min(1, Math.max(0, luma + saturation * (g - luma)))
      b = Math.min(1, Math.max(0, luma + saturation * (b - luma)))
    }
    out[p] = r
    out[p + 1] = g
    out[p + 2] = b
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
