import { describe, expect, it } from 'vitest'
import { focusScore, grayU8ToFloat, luminanceOfRgb, rgbaToGrayU8 } from '../src/lib/image.ts'
import { stackWarped } from '../src/lib/stack.ts'
import {
  chooseAcross,
  cropSidePixels,
  describeSources,
  inspectPlanet,
  resampleCrop,
  squareCrop,
} from '../src/lib/track.ts'

function diskImage(w: number, h: number, cx: number, cy: number, radius: number, blur = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const distance = Math.hypot(x - cx, y - cy)
      const value = distance <= radius ? 200 : distance <= radius + blur ? 40 : 0
      const offset = (y * w + x) * 4
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = Math.round(value * 0.85)
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

function seen(rgba: Uint8ClampedArray, w: number, h: number, time: number) {
  return inspectPlanet(grayU8ToFloat(rgbaToGrayU8(rgba)), w, h, time)
}

describe('Mehrere Aufnahmen', () => {
  it('legt zwei verschieden große Scheiben auf dieselbe Größe und Mitte', () => {
    const wide = [0, 1, 2].map((index) => diskImage(180, 180, 78 + index * 6, 84, 14))
    const close = [0, 1, 2].map((index) => diskImage(180, 180, 96 - index * 4, 92, 26, 1))
    const groups = [wide.map((frame, index) => seen(frame, 180, 180, index)), close.map((frame, index) => seen(frame, 180, 180, index))]
    const plan = chooseAcross(groups, 'match')
    expect(plan).not.toBeNull()
    expect(plan!.perFrame).toBe(true)
    expect(plan!.kept.length).toBe(6)

    const out = 96
    const crops = [...wide, ...close].map((frame, index) => {
      const sample = [...groups[0]!, ...groups[1]!][index]!
      const side = cropSidePixels(sample, plan!)
      const box = squareCrop(sample.cx, sample.cy, side, 180, 180)
      expect(box).not.toBeNull()
      return resampleCrop(frame, 180, 180, box!.sx, box!.sy, box!.side, out)
    })
    const radii = crops.map((crop) => seen(crop, out, out, 0).r)
    const centers = crops.map((crop) => seen(crop, out, out, 0))
    const minR = Math.min(...radii)
    const maxR = Math.max(...radii)
    expect(maxR / minR).toBeLessThan(1.2)
    for (const center of centers) {
      expect(Math.abs(center.cx - (out - 1) / 2)).toBeLessThan(4)
      expect(Math.abs(center.cy - (out - 1) / 2)).toBeLessThan(4)
    }

    const stacked = stackWarped(crops.map((crop) => new Uint8Array(crop)), out, out, 'mean', 2)
    const reference = diskImage(out, out, (out - 1) / 2, (out - 1) / 2, radii[0] ?? 20)
    const score = (image: Float32Array) => focusScore(luminanceOfRgb(image), out, out)
    const mixed = new Float32Array(out * out * 3)
    for (const frame of [...wide, ...close]) {
      for (let i = 0, p = 0; i < out * out; i++, p += 4) {
        const sx = Math.min(179, Math.round((i % out) * (180 / out)))
        const sy = Math.min(179, Math.round(Math.floor(i / out) * (180 / out)))
        const s = (sy * 180 + sx) * 4
        mixed[i * 3] += (frame[s] ?? 0) / 255 / 6
        mixed[i * 3 + 1] += (frame[s + 1] ?? 0) / 255 / 6
        mixed[i * 3 + 2] += (frame[s + 2] ?? 0) / 255 / 6
      }
    }
    const refScore = score(luminanceOfRgb(Float32Array.from({ length: out * out * 3 }, (_, index) => (reference[(index / 3) * 4 + (index % 3)] ?? 0) / 255)))
    void refScore
    expect(score(stacked)).toBeGreaterThan(score(mixed) * 1.3)
  })

  it('nennt die Bilder je Datei', () => {
    const text = describeSources(
      [
        { name: 'nah.mov', count: 12 },
        { name: 'weit.mov', count: 8 },
      ],
      ['alt.mov: Der Browser kann dieses Video nicht abspielen.'],
    )
    expect(text).toContain('nah.mov 12')
    expect(text).toContain('weit.mov 8')
    expect(text).toContain('20 Bilder')
    expect(text).toContain('Übersprungen')
  })
})
