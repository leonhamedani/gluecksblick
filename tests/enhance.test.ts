import { describe, expect, it } from 'vitest'
import { enhanceImage, gentleEnhance, type EnhanceSettings } from '../src/lib/enhance.ts'

const flat: EnhanceSettings = {
  fine: 0,
  mid: 0,
  coarse: 0,
  unsharpAmount: 0,
  unsharpRadius: 1,
  brightness: 0,
  contrast: 1,
  gamma: 1,
  saturation: 1,
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function spread(rgb: Float32Array): number {
  return Math.max(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0) - Math.min(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0)
}

describe('Sättigung', () => {
  const cream = new Float32Array([0.72, 0.66, 0.5])

  it('lässt bei 1 Helligkeit, Kontrast und Gamma unverändert', () => {
    const src = new Float32Array([0.2, 0.55, 0.8, 0.9, 0.4, 0.15])
    const settings: EnhanceSettings = {
      ...flat,
      brightness: gentleEnhance.brightness,
      contrast: gentleEnhance.contrast,
      gamma: gentleEnhance.gamma,
      saturation: 1,
    }
    const out = enhanceImage(src, 2, 1, settings)
    for (let i = 0; i < src.length; i++) {
      let value = src[i] ?? 0
      value = (value - 0.5) * settings.contrast + 0.5 + settings.brightness
      value = Math.pow(Math.min(1, Math.max(0, value)), settings.gamma)
      expect(out[i]).toBeCloseTo(value, 6)
    }
  })

  it('schärft auch bei Sättigung 1 weiter', () => {
    const w = 8
    const h = 8
    const src = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      const on = i % w % 2 === 0 ? 0.8 : 0.2
      src[i * 3] = on
      src[i * 3 + 1] = on * 0.8
      src[i * 3 + 2] = on * 0.5
    }
    const soft = enhanceImage(src, w, h, { ...flat, saturation: 1 })
    const sharp = enhanceImage(src, w, h, { ...flat, fine: 1.2, unsharpAmount: 0.8, saturation: 1 })
    let diff = 0
    for (let i = 0; i < src.length; i++) diff += Math.abs((sharp[i] ?? 0) - (soft[i] ?? 0))
    expect(diff).toBeGreaterThan(0.5)
  })

  it('verstärkt die Farbe und behält die Helligkeit', () => {
    const out = enhanceImage(cream, 1, 1, { ...flat, saturation: 1.5 })
    expect(luma(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)).toBeCloseTo(luma(0.72, 0.66, 0.5), 5)
    expect(spread(out)).toBeGreaterThan(spread(cream))
    expect(out[0] ?? 0).toBeGreaterThan(0.72)
    expect(out[2] ?? 0).toBeLessThan(0.5)
  })

  it('macht bei 0 ein Grau mit derselben Helligkeit', () => {
    const src = new Float32Array([0.8, 0.4, 0.2])
    const out = enhanceImage(src, 1, 1, { ...flat, saturation: 0 })
    const gray = luma(0.8, 0.4, 0.2)
    expect(out[0]).toBeCloseTo(gray, 5)
    expect(out[1]).toBeCloseTo(gray, 5)
    expect(out[2]).toBeCloseTo(gray, 5)
  })

  it('schneidet übersteuerte Kanäle auf 0 bis 1', () => {
    const src = new Float32Array([0.95, 0.15, 0.05])
    const out = enhanceImage(src, 1, 1, { ...flat, saturation: 2 })
    for (let i = 0; i < 3; i++) {
      expect(out[i] ?? -1).toBeGreaterThanOrEqual(0)
      expect(out[i] ?? 2).toBeLessThanOrEqual(1)
    }
    expect(out[0]).toBe(1)
  })

  it('setzt die Vorgabe leicht über 1, noch unter grellem Neon', () => {
    expect(gentleEnhance.saturation).toBeGreaterThanOrEqual(1.2)
    expect(gentleEnhance.saturation).toBeLessThanOrEqual(1.35)
    const washed = enhanceImage(cream, 1, 1, { ...gentleEnhance, fine: 0, mid: 0, coarse: 0, unsharpAmount: 0, saturation: 1 })
    const natural = enhanceImage(cream, 1, 1, { ...gentleEnhance, fine: 0, mid: 0, coarse: 0, unsharpAmount: 0 })
    expect(spread(natural)).toBeGreaterThan(spread(washed))
    expect(natural[0] ?? 0).toBeLessThan(1)
    expect(natural[2] ?? 0).toBeGreaterThan(0)
  })
})
