import { describe, expect, it } from 'vitest'
import { diskCentroid, grayU8ToFloat, rgbaToGrayU8 } from '../src/lib/image.ts'
import { globalShift } from '../src/lib/align.ts'
import {
  chooseTrack,
  diskIsClipped,
  inspectPlanet,
  NO_PLANET_MESSAGE,
  resampleCrop,
  squareCrop,
  type PlanetSample,
} from '../src/lib/track.ts'

function diskImage(w: number, h: number, cx: number, cy: number, r: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4
      const inside = Math.hypot(x - cx, y - cy) <= r
      const value = inside ? 210 : 0
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
      rgba[offset + 3] = 255
    }
  }
  return rgba
}

function at(time: number, cx: number, r: number, clipped = false): PlanetSample {
  return {
    time,
    cx,
    cy: 240,
    r,
    frameW: 270,
    frameH: 480,
    missing: false,
    clipped,
    dark: false,
  }
}

describe('Planet verfolgen', () => {
  it('verwirft eine angeschnittene Scheibe und ein leeres Bild', () => {
    const w = 120
    const h = 160
    const edge = diskImage(w, h, 4, 80, 18)
    const seen = inspectPlanet(grayU8ToFloat(rgbaToGrayU8(edge)), w, h, 0)
    expect(seen.missing).toBe(false)
    expect(seen.clipped).toBe(true)
    expect(diskIsClipped({ cx: 4, cy: 80, r: 18 }, w, h)).toBe(true)
    const empty = inspectPlanet(new Float32Array(w * h), w, h, 1)
    expect(empty.missing).toBe(true)
    expect(empty.dark).toBe(true)
  })

  it('setzt den Ausschnitt so, dass die Scheibe in der Mitte landet', () => {
    const w = 160
    const h = 220
    const rgba = diskImage(w, h, 70, 100, 12)
    const seen = inspectPlanet(grayU8ToFloat(rgbaToGrayU8(rgba)), w, h, 0)
    expect(seen.missing).toBe(false)
    const side = seen.r * 6
    const box = squareCrop(seen.cx, seen.cy, side, w, h)
    expect(box).not.toBeNull()
    const out = 96
    const crop = resampleCrop(rgba, w, h, box!.sx, box!.sy, box!.side, out)
    const again = inspectPlanet(grayU8ToFloat(rgbaToGrayU8(crop)), out, out, 0)
    expect(Math.abs(again.cx - (out - 1) / 2)).toBeLessThan(2.5)
    expect(Math.abs(again.cy - (out - 1) / 2)).toBeLessThan(2.5)
    expect(again.clipped).toBe(false)
  })

  it('wählt die Stelle mit der größten ähnlichen Scheibe', () => {
    const samples: PlanetSample[] = []
    for (let i = 0; i < 8; i++) samples.push(at(i * 0.5, 240 - i * 4, 8))
    for (let i = 0; i < 10; i++) samples.push(at(4 + i * 0.5, 150 - i * 6, 20 + (i % 2)))
    samples.push(at(9.2, 12, 18, true))
    samples.push({ ...at(9.6, 0, 0), missing: true, r: 0 })
    const plan = chooseTrack(samples, 'zoom')
    expect(plan).not.toBeNull()
    expect(plan!.medianR).toBeGreaterThan(18)
    expect(plan!.t0).toBeGreaterThan(3)
    expect(plan!.t1).toBeLessThan(9.2)
    expect(plan!.kept.length).toBeGreaterThanOrEqual(6)
    expect(plan!.note.length).toBeGreaterThan(10)
  })

  it('gibt null zurück, wenn nirgends ein Planet frei im Bild steht', () => {
    const samples = [at(0, 4, 20, true), at(1, 4, 20, true)]
    expect(chooseTrack(samples, 'zoom')).toBeNull()
    expect(NO_PLANET_MESSAGE).toMatch(/Planeten/)
  })

  it('lehnt ein schwarzes Bild in der Planeten-Ausrichtung ab', () => {
    const w = 64
    const h = 64
    const disk = grayU8ToFloat(rgbaToGrayU8(diskImage(w, h, 32, 32, 12)))
    const shift = globalShift(disk, new Float32Array(w * h), w, h, 'planet')
    expect(shift.peak).toBe(0)
    expect(diskCentroid(disk, w, h)).not.toBeNull()
  })
})
