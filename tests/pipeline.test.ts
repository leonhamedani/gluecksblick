import { describe, expect, it } from 'vitest'
import { alignKept, estimateLocal, globalShift, keepIndices, type ProcessOptions } from '../src/lib/align.ts'
import { diskCentroid, focusScore, grayU8ToFloat, luminanceOfRgb, rgbaToGrayU8, sampleGray } from '../src/lib/image.ts'
import { makePlanetSequence, renderSharpPlanet } from '../src/lib/synthetic.ts'
import { sigmaClip, stackWarped, warpFrame } from '../src/lib/stack.ts'
import { encodeTiff16 } from '../src/lib/tiff.ts'
import { gaussianBlur } from '../src/lib/image.ts'

function texture(w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dot = x % 7 === 2 && y % 5 === 1 ? 0.85 : 0
      gray[y * w + x] =
        0.12 +
        0.28 * Math.sin(x * 0.35) * Math.cos(y * 0.27) +
        0.08 * Math.sin(x * 0.9 + y * 0.4) +
        dot
    }
  }
  return gray
}

function translate(src: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = sampleGray(src, w, h, x - dx, y - dy)
      out[y * w + x] = Number.isNaN(value) ? 0 : value
    }
  }
  return out
}

function pipeline(frames: Uint8ClampedArray[], w: number, h: number, opts: ProcessOptions & { keepRatio: number }) {
  const grays = frames.map((frame) => rgbaToGrayU8(frame))
  const scores = grays.map((gray) => focusScore(grayU8ToFloat(gray), w, h))
  const kept = keepIndices(scores, opts.keepRatio)
  const aligned = alignKept(grays, w, h, kept, scores, opts)
  const usable = aligned.shifts.some((shift) => !shift.rejected)
    ? aligned.shifts.filter((shift) => !shift.rejected)
    : aligned.shifts
  const warped = usable.map((shift) => warpFrame(frames[shift.index] ?? new Uint8ClampedArray(w * h * 4), w, h, shift))
  return {
    rgb: stackWarped(warped, w, h, opts.stackMode, opts.sigmaKappa),
    scores,
    usable,
  }
}

function averageRaw(frames: Uint8ClampedArray[], indices: number[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3)
  for (const index of indices) {
    const frame = frames[index]
    if (!frame) continue
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      out[i * 3] += (frame[p] ?? 0) / 255 / indices.length
      out[i * 3 + 1] += (frame[p + 1] ?? 0) / 255 / indices.length
      out[i * 3 + 2] += (frame[p + 2] ?? 0) / 255 / indices.length
    }
  }
  return out
}

const baseOptions: ProcessOptions = {
  motive: 'planet',
  reference: 'average',
  localGrid: 0,
  patchSize: 32,
  minPeak: 0.02,
  minLocalPeak: 0.02,
  stackMode: 'mean',
  sigmaKappa: 2,
}

describe('Phasenkorrelation', () => {
  it('findet eine ganzzahlige Verschiebung', () => {
    const w = 96
    const h = 96
    const ref = texture(w, h)
    const moved = translate(ref, w, h, 4, -2)
    const shift = globalShift(ref, moved, w, h, 'surface')
    expect(Math.abs(shift.dx - 4)).toBeLessThan(0.2)
    expect(Math.abs(shift.dy + 2)).toBeLessThan(0.2)
    expect(shift.peak).toBeGreaterThan(0.2)
  })

  it('verfeinert auf Bruchteile eines Pixels', () => {
    const w = 96
    const h = 96
    const ref = texture(w, h)
    const moved = translate(ref, w, h, 2.5, -1.75)
    const shift = globalShift(ref, moved, w, h, 'surface')
    expect(Math.abs(shift.dx - 2.5)).toBeLessThan(0.35)
    expect(Math.abs(shift.dy + 1.75)).toBeLessThan(0.35)
  })
})

describe('Planet', () => {
  it('findet die Scheibe nahe der Mitte', () => {
    const rgb = renderSharpPlanet(96, 96)
    const gray = new Float32Array(96 * 96)
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.2126 * (rgb[i * 3] ?? 0) + 0.7152 * (rgb[i * 3 + 1] ?? 0) + 0.0722 * (rgb[i * 3 + 2] ?? 0)
    }
    const disk = diskCentroid(gray, 96, 96)
    expect(disk).not.toBeNull()
    expect(Math.abs((disk?.cx ?? 0) - 47.5)).toBeLessThan(1.5)
    expect(Math.abs((disk?.cy ?? 0) - 47.5)).toBeLessThan(1.5)
  })

  it('bewertet ein scharfes Bild höher als ein unscharfes', () => {
    const sharp = renderSharpPlanet(80, 80)
    const gray = new Float32Array(80 * 80)
    for (let i = 0; i < gray.length; i++) gray[i] = sharp[i * 3] ?? 0
    const soft = gaussianBlur(gray, 80, 80, 2.2)
    expect(focusScore(gray, 80, 80)).toBeGreaterThan(focusScore(soft, 80, 80) * 2)
  })

  it('stapelt ausgerichtete Bilder schärfer als das unausgerichtete Mittel', () => {
    const sequence = makePlanetSequence({ w: 112, h: 112, count: 12, seed: 7 })
    const aligned = pipeline(sequence.frames, sequence.w, sequence.h, { ...baseOptions, keepRatio: 0.5 })
    const indices = aligned.usable.map((shift) => shift.index)
    const dull = focusScore(luminanceOfRgb(averageRaw(sequence.frames, indices, sequence.w, sequence.h)), sequence.w, sequence.h)
    const sharp = focusScore(luminanceOfRgb(aligned.rgb), sequence.w, sequence.h)
    expect(sharp, `Stapel ${sharp} gegen unausgerichtet ${dull}`).toBeGreaterThan(dull * 1.35)
    expect(aligned.usable.length).toBeGreaterThan(1)
  }, 60000)

  it('lässt lokale Punkte eine reine Verschiebung intakt', () => {
    const sequence = makePlanetSequence({ w: 112, h: 112, count: 8, seed: 7 })
    const globalOnly = pipeline(sequence.frames, sequence.w, sequence.h, { ...baseOptions, keepRatio: 0.5, localGrid: 0 })
    const local = pipeline(sequence.frames, sequence.w, sequence.h, {
      ...baseOptions,
      keepRatio: 0.5,
      localGrid: 3,
      patchSize: 32,
    })
    const globalScore = focusScore(luminanceOfRgb(globalOnly.rgb), sequence.w, sequence.h)
    const localScore = focusScore(luminanceOfRgb(local.rgb), sequence.w, sequence.h)
    expect(localScore, `lokal ${localScore} gegen global ${globalScore}`).toBeGreaterThan(globalScore * 0.8)
  }, 60000)
})

describe('lokales Punktfeld', () => {
  it('unterscheidet die Verschiebung der beiden Hälften', () => {
    const w = 128
    const h = 128
    const ref = texture(w, h)
    const mov = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x < w / 2 ? 2 : -2.5
        const dy = x < w / 2 ? -1 : 1.5
        const value = sampleGray(ref, w, h, x - dx, y - dy)
        mov[y * w + x] = Number.isNaN(value) ? 0 : value
      }
    }
    const points = estimateLocal(ref, mov, w, h, [
      { x: 28, y: 64 },
      { x: 100, y: 64 },
    ], 32, 0, 0, 0.02)
    const left = points[0]
    const right = points[1]
    expect(left?.valid).toBe(true)
    expect(right?.valid).toBe(true)
    expect(Math.abs((left?.dx ?? 0) - 2)).toBeLessThan(0.45)
    expect(Math.abs((left?.dy ?? 0) + 1)).toBeLessThan(0.45)
    expect(Math.abs((right?.dx ?? 0) + 2.5)).toBeLessThan(0.45)
    expect(Math.abs((right?.dy ?? 0) - 1.5)).toBeLessThan(0.45)
  })
})

describe('Sigma-Clipping und TIFF', () => {
  it('wirft ein helles Ausreißerfeld aus dem Mittel', () => {
    const w = 16
    const h = 16
    const make = (hot: boolean) => {
      const rgba = new Uint8Array(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const value = hot && x >= 6 && x < 10 && y >= 6 && y < 10 ? 255 : 40
          const p = (y * w + x) * 4
          rgba[p] = value
          rgba[p + 1] = value
          rgba[p + 2] = value
          rgba[p + 3] = 255
        }
      }
      return rgba
    }
    const frames = [make(false), make(false), make(false), make(true)]
    const clipped = sigmaClip(frames, w, h, 1.2)
    const mean = stackWarped(frames, w, h, 'mean', 1.2)
    const center = (8 * w + 8) * 3
    expect(clipped[center] ?? 1).toBeLessThan(0.25)
    expect(mean[center] ?? 0).toBeGreaterThan(0.3)
  })

  it('schreibt ein 16-bit-RGB-TIFF', () => {
    const rgb = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1])
    const tiff = encodeTiff16(rgb, 2, 2)
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
    expect(tiff[0]).toBe(0x49)
    expect(tiff[1]).toBe(0x49)
    expect(view.getUint16(2, true)).toBe(42)
    const ifd = view.getUint32(4, true)
    expect(view.getUint16(ifd, true)).toBe(11)
    let width = 0
    let dataOffset = 0
    let cursor = ifd + 2
    for (let i = 0; i < 11; i++) {
      const tag = view.getUint16(cursor, true)
      const value = view.getUint32(cursor + 8, true)
      if (tag === 256) width = value
      if (tag === 273) dataOffset = value
      cursor += 12
    }
    expect(width).toBe(2)
    expect(view.getUint16(dataOffset, true)).toBe(65535)
    expect(view.getUint16(dataOffset + 2, true)).toBe(0)
    expect(view.getUint16(dataOffset + 4, true)).toBe(0)
  })

  it('behält die schärfsten Indizes', () => {
    expect(keepIndices([1, 8, 3, 9], 0.5)).toEqual([1, 3])
  })
})
