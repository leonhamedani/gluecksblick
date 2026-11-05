import { stampName } from './format.ts'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function sharePng(blob: Blob): Promise<'shared' | 'downloaded' | 'aborted'> {
  const filename = stampName('png')
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Glücksblick' })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

export function rgbaToPng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('Die Zeichenfläche fehlt.'))
  const pixels = new Uint8ClampedArray(w * h * 4)
  pixels.set(rgba)
  context.putImageData(new ImageData(pixels, w, h), 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG fehlgeschlagen.'))), 'image/png')
  })
}

let wakeLock: WakeLockSentinel | null = null

export async function acquireWakeLock(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release()
  } catch {
    /* Der Bildschirm darf wieder ausgehen. */
  }
  wakeLock = null
}
