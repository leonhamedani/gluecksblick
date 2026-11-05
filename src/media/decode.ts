import type { Motive } from '../lib/align.ts'
import { grayU8ToFloat, rgbaToGrayU8, stretchIfNeeded } from '../lib/image.ts'
import {
  chooseAcross,
  chooseTrack,
  cropSidePixels,
  describeSources,
  NORMAL,
  innerSpan,
  inspectPlanet,
  keptByFile,
  NO_PLANET_MESSAGE,
  READ_FAILURE_MESSAGE,
  sampleTimes,
  squareCrop,
  VIDEO_DECODE_MESSAGE,
  type PlanetSample,
  type TrackMode,
  type TrackPlan,
} from '../lib/track.ts'

export type DecodeLimits = {
  maxFrames: number
  longEdge: number
  crop: number
  trimStart: number
  trimEnd: number
  motive: Motive
  track: TrackMode
}

export type LoadedSource = {
  label: string
  kind: 'video' | 'bilder' | 'beispiel'
  w: number
  h: number
  count: number
  grays: Uint8Array[]
  thumbs: Uint8ClampedArray[]
  thumbW: number
  thumbH: number
  note: string
  origins: { name: string; count: number }[]
  readFrame: (index: number, signal: AbortSignal) => Promise<Uint8ClampedArray>
  close: () => void
}

const ANALYSIS_EDGE = 640

type Hooks = {
  signal: AbortSignal
  onProgress: (ratio: number, label: string) => void
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError')
}

let frameCanvas: HTMLCanvasElement | null = null
let thumbCanvas: HTMLCanvasElement | null = null

function canvasOf(kind: 'frame' | 'thumb', w: number, h: number): HTMLCanvasElement {
  const current = kind === 'frame' ? frameCanvas : thumbCanvas
  const canvas = current ?? document.createElement('canvas')
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  if (kind === 'frame') frameCanvas = canvas
  else thumbCanvas = canvas
  return canvas
}

export function fittedSize(srcW: number, srcH: number, longEdge: number, crop: number) {
  const fraction = Math.min(1, Math.max(0.35, crop))
  const sw = Math.max(1, Math.round(srcW * fraction))
  const sh = Math.max(1, Math.round(srcH * fraction))
  const scale = Math.min(1, longEdge / Math.max(sw, sh))
  let dw = Math.max(16, Math.round(sw * scale))
  let dh = Math.max(16, Math.round(sh * scale))
  if (dw % 2) dw -= 1
  if (dh % 2) dh -= 1
  dw = Math.max(16, dw)
  dh = Math.max(16, dh)
  return { sx: Math.floor((srcW - sw) / 2), sy: Math.floor((srcH - sh) / 2), sw, sh, dw, dh }
}

function paint(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  limits: DecodeLimits,
): { rgba: Uint8ClampedArray; w: number; h: number; gray: Uint8Array; thumb: Uint8ClampedArray; tw: number; th: number } {
  const fit = fittedSize(srcW, srcH, limits.longEdge, limits.crop)
  const canvas = canvasOf('frame', fit.dw, fit.dh)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Die Zeichenfläche fehlt.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, fit.dw, fit.dh)
  context.drawImage(source, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, fit.dw, fit.dh)
  const rgba = new Uint8ClampedArray(context.getImageData(0, 0, fit.dw, fit.dh).data)
  stretchIfNeeded(rgba, fit.dw, fit.dh)
  const scale = 72 / Math.max(fit.dw, fit.dh)
  const tw = Math.max(1, Math.round(fit.dw * scale))
  const th = Math.max(1, Math.round(fit.dh * scale))
  const thumb = canvasOf('thumb', tw, th)
  const thumbContext = thumb.getContext('2d')
  if (!thumbContext) throw new Error('Die Vorschau fehlt.')
  thumbContext.imageSmoothingEnabled = true
  thumbContext.drawImage(canvas, 0, 0, tw, th)
  return {
    rgba,
    w: fit.dw,
    h: fit.dh,
    gray: rgbaToGrayU8(rgba),
    thumb: new Uint8ClampedArray(thumbContext.getImageData(0, 0, tw, th).data),
    tw,
    th,
  }
}

function guardMemory(count: number, w: number, h: number) {
  if (count * w * h > 72 * 1024 * 1024) {
    throw new Error('Das ist zu viel für den Speicher. Nimm weniger Bilder oder eine kürzere Kante.')
  }
}

function pack(
  label: string,
  kind: LoadedSource['kind'],
  frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[],
  w: number,
  h: number,
  tw: number,
  th: number,
  note: string,
  readFrame: LoadedSource['readFrame'],
  close: () => void,
  origins: { name: string; count: number }[] = [],
): LoadedSource {
  return {
    label,
    kind,
    w,
    h,
    count: frames.length,
    grays: frames.map((frame) => frame.gray),
    thumbs: frames.map((frame) => frame.thumb),
    thumbW: tw,
    thumbH: th,
    note,
    origins,
    readFrame,
    close,
  }
}

function evenSide(value: number): number {
  let side = Math.max(64, Math.round(value))
  if (side % 2) side -= 1
  return side
}

function scaledSize(srcW: number, srcH: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(srcW, srcH))
  let dw = Math.max(16, Math.round(srcW * scale))
  let dh = Math.max(16, Math.round(srcH * scale))
  if (dw % 2) dw -= 1
  if (dh % 2) dh -= 1
  return { dw: Math.max(16, dw), dh: Math.max(16, dh) }
}

function drawTo(w: number, h: number, draw: (context: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const canvas = canvasOf('frame', w, h)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Die Zeichenfläche fehlt.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.clearRect(0, 0, w, h)
  draw(context)
  return new Uint8ClampedArray(context.getImageData(0, 0, w, h).data)
}

function thumbOf(w: number, h: number): { thumb: Uint8ClampedArray; tw: number; th: number } {
  const canvas = canvasOf('frame', w, h)
  const scale = 72 / Math.max(w, h)
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const thumb = canvasOf('thumb', tw, th)
  const context = thumb.getContext('2d')
  if (!context) throw new Error('Die Vorschau fehlt.')
  context.imageSmoothingEnabled = true
  context.drawImage(canvas, 0, 0, tw, th)
  return { thumb: new Uint8ClampedArray(context.getImageData(0, 0, tw, th).data), tw, th }
}

function prepareRgba(rgba: Uint8ClampedArray, w: number, h: number): { rgba: Uint8ClampedArray; gray: Uint8Array } {
  stretchIfNeeded(rgba, w, h)
  return { rgba, gray: rgbaToGrayU8(rgba) }
}

function paintScaled(source: CanvasImageSource, srcW: number, srcH: number, longEdge: number) {
  const size = scaledSize(srcW, srcH, longEdge)
  const rgba = drawTo(size.dw, size.dh, (context) => {
    context.drawImage(source, 0, 0, srcW, srcH, 0, 0, size.dw, size.dh)
  })
  const prepared = prepareRgba(rgba, size.dw, size.dh)
  return { ...size, ...prepared, w: size.dw, h: size.dh }
}

function paintCrop(source: CanvasImageSource, sx: number, sy: number, side: number, out: number): Uint8ClampedArray {
  const rgba = drawTo(out, out, (context) => {
    context.drawImage(source, sx, sy, side, side, 0, 0, out, out)
  })
  const prepared = prepareRgba(rgba, out, out).rgba
  const canvas = canvasOf('frame', out, out)
  const pixels = new Uint8ClampedArray(out * out * 4)
  pixels.set(prepared)
  canvas.getContext('2d')?.putImageData(new ImageData(pixels, out, out), 0, 0)
  return prepared
}

async function seekTo(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  throwIfAborted(signal)
  if (Math.abs(video.currentTime - time) < 0.0008 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Das Video springt nicht zum nächsten Bild.'))
    }, 8000)
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('Abgebrochen', 'AbortError'))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    video.addEventListener('seeked', onSeeked, { once: true })
    video.currentTime = Math.min(time, Math.max(0, (video.duration || time) - 0.001))
  })
  if ('requestVideoFrameCallback' in video) {
    await Promise.race([
      new Promise<void>((resolve) => {
        video.requestVideoFrameCallback(() => resolve())
      }),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 180)
      }),
    ])
  }
}

async function primeVideo(video: HTMLVideoElement) {
  try {
    await video.play()
    video.pause()
  } catch {
    /* Stumm geschaltetes Suchen klappt oft auch ohne Wiedergabe. */
  }
}

function attachVideo(file: File): Promise<{ video: HTMLVideoElement; close: () => void }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('playsinline', 'true')
  video.tabIndex = -1
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0'
  document.body.appendChild(video)
  const close = () => {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      close()
      reject(new Error(VIDEO_DECODE_MESSAGE))
    }, 8000)
    const onReady = () => {
      window.clearTimeout(timer)
      cleanup()
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth < 2) {
        close()
        reject(new Error(VIDEO_DECODE_MESSAGE))
        return
      }
      resolve({ video, close })
    }
    const onError = () => {
      window.clearTimeout(timer)
      cleanup()
      close()
      reject(new Error(VIDEO_DECODE_MESSAGE))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('error', onError)
    video.src = url
  })
}

export async function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  const { video, close } = await attachVideo(file)
  const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight }
  close()
  return result
}

function trimWindow(duration: number, limits: DecodeLimits) {
  const start = Math.min(0.98, Math.max(0, limits.trimStart))
  const end = Math.min(1, Math.max(start + 0.02, limits.trimEnd))
  return { t0: duration * start, t1: Math.max(duration * start + 0.05, duration * end - 0.04) }
}

async function measurePlanet(video: HTMLVideoElement, srcW: number, srcH: number, time: number): Promise<PlanetSample> {
  const view = paintScaled(video, srcW, srcH, ANALYSIS_EDGE)
  return inspectPlanet(grayU8ToFloat(view.gray), view.w, view.h, time)
}

export async function loadVideo(file: File, limits: DecodeLimits, hooks: Hooks): Promise<LoadedSource> {
  const { video, close } = await attachVideo(file)
  try {
    await primeVideo(video)
    const srcW = video.videoWidth
    const srcH = video.videoHeight
    const { t0, t1 } = trimWindow(video.duration, limits)
    if (limits.motive !== 'planet') {
      const count = Math.max(2, Math.round(limits.maxFrames))
      const times = sampleTimes(t0, t1, count)
      const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
      const keptTimes: number[] = []
      let w = 0
      let h = 0
      let tw = 0
      let th = 0
      for (let index = 0; index < times.length; index++) {
        throwIfAborted(hooks.signal)
        hooks.onProgress(index / times.length, 'Video wird gelesen')
        const time = times[index] ?? t0
        try {
          await seekTo(video, time, hooks.signal)
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error
          continue
        }
        const painted = paint(video, srcW, srcH, limits)
        if (frames.length === 0) {
          w = painted.w
          h = painted.h
          tw = painted.tw
          th = painted.th
          guardMemory(count, w, h)
        }
        frames.push({ gray: painted.gray, thumb: painted.thumb })
        keptTimes.push(time)
      }
      if (frames.length < 2) throw new Error(VIDEO_DECODE_MESSAGE)
      return pack(file.name, 'video', frames, w, h, tw, th, '', async (index, signal) => {
        await seekTo(video, keptTimes[index] ?? t0, signal)
        return paint(video, srcW, srcH, limits).rgba
      }, close)
    }

    const detectCount = Math.min(36, Math.max(16, Math.round(limits.maxFrames)))
    const detectTimes = sampleTimes(t0, t1, detectCount)
    const samples: PlanetSample[] = []
    for (let index = 0; index < detectTimes.length; index++) {
      throwIfAborted(hooks.signal)
      hooks.onProgress((index / detectTimes.length) * 0.42, 'Planet wird gesucht')
      const time = detectTimes[index] ?? t0
      try {
        await seekTo(video, time, hooks.signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        samples.push({ time, cx: 0, cy: 0, r: 0, frameW: 1, frameH: 1, missing: true, clipped: false, dark: true })
        continue
      }
      samples.push(await measurePlanet(video, srcW, srcH, time))
    }
    if (samples.length > 0 && samples.every((sample) => sample.dark)) {
      throw new Error(`${VIDEO_DECODE_MESSAGE} Die Bilder kamen schwarz an.`)
    }
    const plan = chooseTrack(samples, limits.track)
    if (!plan) throw new Error(NO_PLANET_MESSAGE)
    const window = innerSpan(plan.t0, plan.t1)
    const times = sampleTimes(window.t0, window.t1, limits.maxFrames)
    const analysisW = samples.find((sample) => sample.frameW > 1)?.frameW ?? srcW
    const toSrc = srcW / analysisW
    const out = evenSide(Math.min(limits.longEdge, plan.medianR * plan.factor * toSrc))
    guardMemory(times.length, out, out)
    const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
    const crops: { time: number; sx: number; sy: number; side: number }[] = []
    let skipped = 0
    let tw = 0
    let th = 0
    for (let index = 0; index < times.length; index++) {
      throwIfAborted(hooks.signal)
      hooks.onProgress(0.42 + (index / times.length) * 0.58, 'Ausschnitt um den Planeten')
      const time = times[index] ?? window.t0
      try {
        await seekTo(video, time, hooks.signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        skipped++
        continue
      }
      const seen = await measurePlanet(video, srcW, srcH, time)
      const offScale = !plan.perFrame && (seen.r < plan.medianR * 0.78 || seen.r > plan.medianR * 1.28)
      const sideAnalysis = (plan.perFrame ? seen.r : plan.medianR) * plan.factor
      const box = seen.missing || seen.clipped || offScale ? null : squareCrop(seen.cx, seen.cy, sideAnalysis, seen.frameW, seen.frameH)
      if (!box) {
        skipped++
        continue
      }
      const crop = { time, sx: box.sx * toSrc, sy: box.sy * toSrc, side: box.side * toSrc }
      const rgba = paintCrop(video, crop.sx, crop.sy, crop.side, out)
      const thumb = thumbOf(out, out)
      tw = thumb.tw
      th = thumb.th
      frames.push({ gray: rgbaToGrayU8(rgba), thumb: thumb.thumb })
      crops.push(crop)
    }
    if (frames.length < 2) throw new Error(NO_PLANET_MESSAGE)
    const note = skipped ? `${plan.note} Beim Zuschneiden fielen ${skipped} weitere Bilder weg.` : plan.note
    return pack(file.name, 'video', frames, out, out, tw, th, note, async (index, signal) => {
      const crop = crops[index]
      if (!crop) throw new Error('Bild fehlt.')
      await seekTo(video, crop.time, signal)
      return paintCrop(video, crop.sx, crop.sy, crop.side, out)
    }, close)
  } catch (error) {
    close()
    throw error
  }
}

async function loadPlanetImages(files: File[], limits: DecodeLimits, hooks: Hooks): Promise<LoadedSource> {
  const chosen = files.slice(0, Math.max(2, Math.round(limits.maxFrames)))
  const samples: PlanetSample[] = []
  const usableFiles: File[] = []
  for (let index = 0; index < chosen.length; index++) {
    throwIfAborted(hooks.signal)
    hooks.onProgress((index / chosen.length) * 0.45, 'Planet wird gesucht')
    const file = chosen[index]
    if (!file || /heic|heif/i.test(file.type) || /\.heic$/i.test(file.name)) continue
    try {
      const bitmap = await createImageBitmap(file)
      try {
        const view = paintScaled(bitmap, bitmap.width, bitmap.height, ANALYSIS_EDGE)
        const sample = inspectPlanet(grayU8ToFloat(view.gray), view.w, view.h, index)
        sample.cx *= bitmap.width / view.w
        sample.cy *= bitmap.height / view.h
        sample.r *= bitmap.width / view.w
        sample.frameW = bitmap.width
        sample.frameH = bitmap.height
        samples.push(sample)
        usableFiles.push(file)
      } finally {
        bitmap.close()
      }
    } catch {
      continue
    }
  }
  const plan = chooseTrack(samples, limits.track)
  if (!plan) throw new Error(NO_PLANET_MESSAGE)
  const out = evenSide(Math.min(limits.longEdge, plan.medianR * plan.factor))
  const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
  const crops: { file: File; sx: number; sy: number; side: number }[] = []
  let tw = 0
  let th = 0
  for (const index of plan.kept) {
    throwIfAborted(hooks.signal)
    const file = usableFiles[index]
    const native = samples[index]
    if (!file || !native) continue
    const side = (plan.perFrame ? native.r : plan.medianR) * plan.factor
    const box = squareCrop(native.cx, native.cy, side, native.frameW, native.frameH)
    if (!box) continue
    const bitmap = await createImageBitmap(file)
    try {
      const rgba = paintCrop(bitmap, box.sx, box.sy, box.side, out)
      const thumb = thumbOf(out, out)
      tw = thumb.tw
      th = thumb.th
      frames.push({ gray: rgbaToGrayU8(rgba), thumb: thumb.thumb })
      crops.push({ file, sx: box.sx, sy: box.sy, side: box.side })
    } finally {
      bitmap.close()
    }
  }
  if (frames.length < 2) throw new Error(NO_PLANET_MESSAGE)
  guardMemory(frames.length, out, out)
  return pack(`${frames.length} Bilder`, 'bilder', frames, out, out, tw, th, plan.note, async (index) => {
    const crop = crops[index]
    if (!crop) throw new Error('Bild fehlt.')
    const bitmap = await createImageBitmap(crop.file)
    try {
      return paintCrop(bitmap, crop.sx, crop.sy, crop.side, out)
    } finally {
      bitmap.close()
    }
  }, () => undefined)
}

export async function loadImages(files: File[], limits: DecodeLimits, hooks: Hooks): Promise<LoadedSource> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
  if (limits.motive === 'planet') return loadPlanetImages(sorted, limits, hooks)
  const chosen = sorted.slice(0, Math.max(2, Math.round(limits.maxFrames)))
  const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
  const kept: File[] = []
  let w = 0
  let h = 0
  let tw = 0
  let th = 0
  let skipped = 0
  for (let index = 0; index < chosen.length; index++) {
    throwIfAborted(hooks.signal)
    hooks.onProgress(index / chosen.length, 'Bilder werden gelesen')
    const file = chosen[index]
    if (!file) continue
    if (/heic|heif/i.test(file.type) || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name)) {
      skipped++
      continue
    }
    try {
      const bitmap = await createImageBitmap(file)
      try {
        const painted = paint(bitmap, bitmap.width, bitmap.height, limits)
        if (frames.length === 0) {
          w = painted.w
          h = painted.h
          tw = painted.tw
          th = painted.th
          guardMemory(chosen.length, w, h)
        }
        frames.push({ gray: painted.gray, thumb: painted.thumb })
        kept.push(file)
      } finally {
        bitmap.close()
      }
    } catch {
      skipped++
    }
  }
  if (frames.length < 2) {
    throw new Error(
      skipped
        ? 'Die Bilder ließen sich nicht lesen. JPEG, PNG oder WebP funktionieren.'
        : 'Bitte mindestens zwei Bilder wählen.',
    )
  }
  return pack(
    `${kept.length} Bilder${skipped ? `, ${skipped} übersprungen` : ''}`,
    'bilder',
    frames,
    w,
    h,
    tw,
    th,
    '',
    async (index) => {
      const file = kept[index]
      if (!file) throw new Error('Bild fehlt.')
      const bitmap = await createImageBitmap(file)
      try {
        return paint(bitmap, bitmap.width, bitmap.height, limits).rgba
      } finally {
        bitmap.close()
      }
    },
    () => undefined,
  )
}

export async function loadMemory(
  framesIn: Uint8ClampedArray[],
  w: number,
  h: number,
  label: string,
  hooks: Hooks,
): Promise<LoadedSource> {
  const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
  let tw = 0
  let th = 0
  for (let index = 0; index < framesIn.length; index++) {
    throwIfAborted(hooks.signal)
    hooks.onProgress(index / framesIn.length, 'Beispiel wird vorbereitet')
    const rgba = framesIn[index]
    if (!rgba) continue
    const canvas = canvasOf('frame', w, h)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Die Zeichenfläche fehlt.')
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
    const scale = 72 / Math.max(w, h)
    tw = Math.max(1, Math.round(w * scale))
    th = Math.max(1, Math.round(h * scale))
    const thumb = canvasOf('thumb', tw, th)
    const thumbContext = thumb.getContext('2d')
    if (!thumbContext) throw new Error('Die Vorschau fehlt.')
    thumbContext.drawImage(canvas, 0, 0, tw, th)
    frames.push({
      gray: rgbaToGrayU8(rgba),
      thumb: new Uint8ClampedArray(thumbContext.getImageData(0, 0, tw, th).data),
    })
    if (index % 2 === 1) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }
  return pack(
    label,
    'beispiel',
    frames,
    w,
    h,
    tw,
    th,
    '',
    async (index) => new Uint8ClampedArray(framesIn[index] ?? new Uint8ClampedArray(w * h * 4)),
    () => undefined,
  )
}

export type BatchEntry = { file: File; kind: 'video' | 'bild' }

type Recipe = {
  file: File
  kind: 'video' | 'bild'
  name: string
  time: number
  sx: number
  sy: number
  sw: number
  sh: number
}

function textOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return VIDEO_DECODE_MESSAGE
}

function paintRect(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const rgba = drawTo(dw, dh, (context) => {
    context.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh)
  })
  const prepared = prepareRgba(rgba, dw, dh).rgba
  const pixels = new Uint8ClampedArray(dw * dh * 4)
  pixels.set(prepared)
  canvasOf('frame', dw, dh).getContext('2d')?.putImageData(new ImageData(pixels, dw, dh), 0, 0)
  return prepared
}

async function scanVideoFile(
  file: File,
  limits: DecodeLimits,
  signal: AbortSignal,
): Promise<{ samples: PlanetSample[]; srcW: number; srcH: number }> {
  const { video, close } = await attachVideo(file)
  try {
    await primeVideo(video)
    const srcW = video.videoWidth
    const srcH = video.videoHeight
    const { t0, t1 } = trimWindow(video.duration, limits)
    const times = sampleTimes(t0, t1, Math.min(28, Math.max(12, Math.round(limits.maxFrames / 2))))
    const samples: PlanetSample[] = []
    for (const time of times) {
      throwIfAborted(signal)
      try {
        await seekTo(video, time, signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        continue
      }
      samples.push(await measurePlanet(video, srcW, srcH, time))
    }
    if (samples.length === 0) throw new Error(READ_FAILURE_MESSAGE)
    if (samples.every((sample) => sample.dark)) {
      throw new Error(`${VIDEO_DECODE_MESSAGE} Die Bilder kamen schwarz an.`)
    }
    return { samples, srcW, srcH }
  } finally {
    close()
  }
}

async function scanImageFile(file: File): Promise<PlanetSample> {
  const bitmap = await createImageBitmap(file)
  try {
    const view = paintScaled(bitmap, bitmap.width, bitmap.height, ANALYSIS_EDGE)
    const sample = inspectPlanet(grayU8ToFloat(view.gray), view.w, view.h, 0)
    sample.cx *= bitmap.width / view.w
    sample.cy *= bitmap.height / view.h
    sample.r *= bitmap.width / view.w
    sample.frameW = bitmap.width
    sample.frameH = bitmap.height
    return sample
  } finally {
    bitmap.close()
  }
}

export async function loadMany(entries: BatchEntry[], limits: DecodeLimits, hooks: Hooks): Promise<LoadedSource> {
  if (entries.length === 1 && entries[0]?.kind === 'video') {
    return loadVideo(entries[0].file, limits, hooks)
  }
  if (entries.length > 0 && entries.every((entry) => entry.kind === 'bild') && limits.motive !== 'planet') {
    return loadImages(entries.map((entry) => entry.file), limits, hooks)
  }
  if (entries.length === 1 && entries[0]?.kind === 'bild') {
    return loadImages([entries[0].file], limits, hooks)
  }

  const failures: string[] = []
  const scanned: { entry: BatchEntry; samples: PlanetSample[]; srcW: number; srcH: number }[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry) continue
    throwIfAborted(hooks.signal)
    hooks.onProgress(index / entries.length * 0.3, `${entry.file.name} wird gelesen`)
    try {
      if (entry.kind === 'video') {
        const scan = await scanVideoFile(entry.file, limits, hooks.signal)
        scanned.push({ entry, ...scan })
      } else {
        const sample = await scanImageFile(entry.file)
        scanned.push({ entry, samples: [sample], srcW: sample.frameW, srcH: sample.frameH })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      failures.push(`${entry.file.name}: ${textOf(error)}`)
    }
  }
  if (scanned.length === 0) {
    throw new Error(failures[0] ?? READ_FAILURE_MESSAGE)
  }

  const out = evenSide(limits.longEdge)
  const recipes: Recipe[] = []
  const frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[] = []
  let tw = 0
  let th = 0

  if (limits.motive === 'planet') {
    const groups = scanned.map((item) => item.samples)
    if (groups.every((group) => group.length === 0)) {
      throw new Error(failures[0] ?? READ_FAILURE_MESSAGE)
    }
    const plan = chooseAcross(groups, limits.track)
    if (!plan) throw new Error(failures.length ? `${NO_PLANET_MESSAGE} ${failures.join(' ')}` : NO_PLANET_MESSAGE)
    const picked = keptByFile(groups, plan.kept)
    let tried = 0
    let unread = 0
    for (let index = 0; index < scanned.length; index++) {
      const item = scanned[index]
      const chosen = picked[index] ?? []
      if (!item || chosen.length === 0) continue
      tried += 1
      const taken = await extractPlanet(item, chosen, plan, limits, out, hooks)
      if (taken.unread) unread += 1
      for (const piece of taken.pieces) {
        frames.push({ gray: piece.gray, thumb: piece.thumb })
        recipes.push(piece.recipe)
        tw = piece.tw
        th = piece.th
      }
    }
    if (frames.length < 2) {
      throw new Error(frames.length === 0 && tried > 0 && unread === tried ? READ_FAILURE_MESSAGE : NO_PLANET_MESSAGE)
    }
    const origins = countOrigins(recipes)
    const note = `${describeSources(origins, failures)} ${plan.note}`
    return finishMany(frames, out, out, tw, th, note, origins, recipes)
  }

  for (const item of scanned) {
    const taken = await extractSurface(item, limits, out, hooks)
    for (const piece of taken) {
      frames.push({ gray: piece.gray, thumb: piece.thumb })
      recipes.push(piece.recipe)
      tw = piece.tw
      th = piece.th
    }
  }
  if (frames.length < 2) throw new Error(frames.length === 0 ? (failures[0] ?? READ_FAILURE_MESSAGE) : (failures[0] ?? 'Zu wenige Bilder.'))
  const origins = countOrigins(recipes)
  return finishMany(frames, out, out, tw, th, describeSources(origins, failures), origins, recipes)
}

function countOrigins(recipes: Recipe[]): { name: string; count: number }[] {
  const rows: { name: string; count: number }[] = []
  for (const recipe of recipes) {
    const last = rows[rows.length - 1]
    if (last && last.name === recipe.name) last.count += 1
    else rows.push({ name: recipe.name, count: 1 })
  }
  return rows
}

type Taken = { gray: Uint8Array; thumb: Uint8ClampedArray; tw: number; th: number; recipe: Recipe }

type TakenBatch = { pieces: Taken[]; unread: boolean }

async function extractPlanet(
  item: { entry: BatchEntry; samples: PlanetSample[]; srcW: number; srcH: number },
  kept: PlanetSample[],
  plan: TrackPlan,
  limits: DecodeLimits,
  out: number,
  hooks: Hooks,
): Promise<TakenBatch> {
  if (item.entry.kind === 'bild') {
    const bitmap = await createImageBitmap(item.entry.file)
    try {
      const sample = kept[0]
      if (!sample || sample.missing || sample.clipped) return { pieces: [], unread: false }
      const side = cropSidePixels(sample, plan)
      const box = squareCrop(sample.cx, sample.cy, side, sample.frameW, sample.frameH)
      if (!box) return { pieces: [], unread: false }
      const rgba = paintCrop(bitmap, box.sx, box.sy, box.side, out)
      const thumb = thumbOf(out, out)
      return {
        unread: false,
        pieces: [{
          gray: rgbaToGrayU8(rgba),
          thumb: thumb.thumb,
          tw: thumb.tw,
          th: thumb.th,
          recipe: { file: item.entry.file, kind: 'bild', name: item.entry.file.name, time: 0, sx: box.sx, sy: box.sy, sw: box.side, sh: box.side },
        }],
      }
    } finally {
      bitmap.close()
    }
  }
  const times = kept.map((sample) => sample.time)
  if (times.length === 0) return { pieces: [], unread: false }
  const window = innerSpan(Math.min(...times), Math.max(...times))
  const probes = sampleTimes(window.t0, window.t1, limits.maxFrames)
  const { video, close } = await attachVideo(item.entry.file)
  const taken: Taken[] = []
  let sawFrame = false
  try {
    await primeVideo(video)
    for (const time of probes) {
      throwIfAborted(hooks.signal)
      hooks.onProgress(0.35, `${item.entry.file.name} wird ausgeschnitten`)
      try {
        await seekTo(video, time, hooks.signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        continue
      }
      sawFrame = true
      const seen = await measurePlanet(video, item.srcW, item.srcH, time)
      if (seen.missing || seen.clipped) continue
      const unit = Math.min(seen.frameW, seen.frameH)
      if (!plan.perFrame && plan.normalized && (seen.r / unit < (plan.medianR / NORMAL) * 0.78 || seen.r / unit > (plan.medianR / NORMAL) * 1.28)) continue
      const sideA = cropSidePixels(seen, plan)
      const box = squareCrop(seen.cx, seen.cy, sideA, seen.frameW, seen.frameH)
      if (!box) continue
      const scale = item.srcW / seen.frameW
      const rgba = paintCrop(video, box.sx * scale, box.sy * scale, box.side * scale, out)
      const thumb = thumbOf(out, out)
      taken.push({
        gray: rgbaToGrayU8(rgba),
        thumb: thumb.thumb,
        tw: thumb.tw,
        th: thumb.th,
        recipe: {
          file: item.entry.file,
          kind: 'video',
          name: item.entry.file.name,
          time,
          sx: box.sx * scale,
          sy: box.sy * scale,
          sw: box.side * scale,
          sh: box.side * scale,
        },
      })
    }
  } finally {
    close()
  }
  return { pieces: taken, unread: probes.length > 0 && !sawFrame }
}

async function extractSurface(
  item: { entry: BatchEntry; srcW: number; srcH: number },
  limits: DecodeLimits,
  out: number,
  hooks: Hooks,
): Promise<Taken[]> {
  if (item.entry.kind === 'bild') {
    const bitmap = await createImageBitmap(item.entry.file)
    try {
      const painted = paint(bitmap, bitmap.width, bitmap.height, limits)
      const rgba = paintRect(bitmap, 0, 0, bitmap.width, bitmap.height, out, out)
      const thumb = thumbOf(out, out)
      void painted
      return [{
        gray: rgbaToGrayU8(rgba),
        thumb: thumb.thumb,
        tw: thumb.tw,
        th: thumb.th,
        recipe: { file: item.entry.file, kind: 'bild', name: item.entry.file.name, time: 0, sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height },
      }]
    } finally {
      bitmap.close()
    }
  }
  const { video, close } = await attachVideo(item.entry.file)
  const taken: Taken[] = []
  try {
    await primeVideo(video)
    const { t0, t1 } = trimWindow(video.duration, limits)
    const times = sampleTimes(t0, t1, limits.maxFrames)
    const fit = fittedSize(item.srcW, item.srcH, limits.longEdge, limits.crop)
    for (const time of times) {
      throwIfAborted(hooks.signal)
      try {
        await seekTo(video, time, hooks.signal)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        continue
      }
      const rgba = paintRect(video, fit.sx, fit.sy, fit.sw, fit.sh, out, out)
      const thumb = thumbOf(out, out)
      taken.push({
        gray: rgbaToGrayU8(rgba),
        thumb: thumb.thumb,
        tw: thumb.tw,
        th: thumb.th,
        recipe: { file: item.entry.file, kind: 'video', name: item.entry.file.name, time, sx: fit.sx, sy: fit.sy, sw: fit.sw, sh: fit.sh },
      })
    }
  } finally {
    close()
  }
  return taken
}

function finishMany(
  frames: { gray: Uint8Array; thumb: Uint8ClampedArray }[],
  w: number,
  h: number,
  tw: number,
  th: number,
  note: string,
  origins: { name: string; count: number }[],
  recipes: Recipe[],
): LoadedSource {
  guardMemory(frames.length, w, h)
  let current: { file: File; video: HTMLVideoElement; close: () => void } | null = null
  return pack(
    origins.map((row) => row.name).join(', '),
    'video',
    frames,
    w,
    h,
    tw,
    th,
    note,
    async (index, signal) => {
      const recipe = recipes[index]
      if (!recipe) throw new Error('Bild fehlt.')
      if (recipe.kind === 'bild') {
        const bitmap = await createImageBitmap(recipe.file)
        try {
          return paintRect(bitmap, recipe.sx, recipe.sy, recipe.sw, recipe.sh, w, h)
        } finally {
          bitmap.close()
        }
      }
      if (!current || current.file !== recipe.file) {
        current?.close()
        current = { file: recipe.file, ...(await attachVideo(recipe.file)) }
        await primeVideo(current.video)
      }
      await seekTo(current.video, recipe.time, signal)
      return paintRect(current.video, recipe.sx, recipe.sy, recipe.sw, recipe.sh, w, h)
    },
    () => {
      current?.close()
      current = null
    },
    origins,
  )
}
