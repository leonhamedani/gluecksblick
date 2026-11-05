import type { FrameShift, ProcessOptions } from './align.ts'
import type { EnhanceSettings } from './enhance.ts'
import type { WorkerRequest, WorkerResponse } from './messages.ts'

type Pending = {
  resolve: (message: WorkerResponse) => void
  reject: (error: Error) => void
  onProgress?: (ratio: number, label: string) => void
}

export class Processor {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private seq = 1
  accel: 'WebGL' | 'Prozessor' = 'Prozessor'
  onReady: ((accel: 'WebGL' | 'Prozessor') => void) | null = null

  private ensure(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('../workers/process.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        this.accel = message.accel === 'webgl' ? 'WebGL' : 'Prozessor'
        this.onReady?.(this.accel)
        return
      }
      const slot = this.pending.get(message.id)
      if (!slot) return
      if (message.type === 'progress') {
        slot.onProgress?.(message.ratio, message.label)
        return
      }
      this.pending.delete(message.id)
      if (message.type === 'error') slot.reject(new Error(message.message))
      else slot.resolve(message)
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Die Hintergrundrechnung ist abgestürzt.')
      for (const slot of this.pending.values()) slot.reject(error)
      this.pending.clear()
    }
    this.worker = worker
    return worker
  }

  cancel(): void {
    this.worker?.terminate()
    this.worker = null
    const error = new DOMException('Abgebrochen', 'AbortError')
    for (const slot of this.pending.values()) slot.reject(error)
    this.pending.clear()
  }

  private call(
    message: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: Pending['onProgress'],
  ): Promise<WorkerResponse> {
    const worker = this.ensure()
    const id = this.seq++
    const payload = { ...message, id } as WorkerRequest
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      worker.postMessage(payload, transfer)
    })
  }

  async score(grays: Uint8Array[], w: number, h: number, onProgress?: Pending['onProgress']): Promise<number[]> {
    const message = await this.call({ id: 0, type: 'score', grays, w, h }, [], onProgress)
    if (message.type !== 'score') throw new Error('Die Schärfewerte fehlen.')
    return message.scores
  }

  async align(
    grays: Uint8Array[],
    w: number,
    h: number,
    scores: number[],
    kept: number[],
    options: ProcessOptions,
    onProgress?: Pending['onProgress'],
  ): Promise<FrameShift[]> {
    const message = await this.call({ id: 0, type: 'align', grays, w, h, scores, kept, options }, [], onProgress)
    if (message.type !== 'align') throw new Error('Die Ausrichtung fehlt.')
    return message.shifts
  }

  async stackInit(w: number, h: number, mode: 'mean' | 'sigma', kappa: number): Promise<void> {
    const message = await this.call({ id: 0, type: 'stack-init', w, h, mode, kappa })
    if (message.type !== 'ack') throw new Error('Der Stapel ließ sich nicht anlegen.')
  }

  async stackAdd(rgba: Uint8Array | Uint8ClampedArray, shift: FrameShift): Promise<void> {
    const copy = new Uint8Array(rgba)
    const message = await this.call({ id: 0, type: 'stack-add', rgba: copy, shift }, [copy.buffer])
    if (message.type !== 'ack') throw new Error('Ein Bild konnte nicht gestapelt werden.')
  }

  async stackFinish(): Promise<{ rgb: Float32Array; used: number }> {
    const message = await this.call({ id: 0, type: 'stack-finish' })
    if (message.type !== 'stack') throw new Error('Der Stapel kam leer zurück.')
    return { rgb: message.rgb, used: message.used }
  }

  async enhance(rgb: Float32Array, w: number, h: number, settings: EnhanceSettings): Promise<Uint8ClampedArray> {
    const copy = new Float32Array(rgb)
    const message = await this.call({ id: 0, type: 'enhance', rgb: copy, w, h, settings }, [copy.buffer])
    if (message.type !== 'preview') throw new Error('Die Vorschau fehlt.')
    return message.rgba
  }

  async tiff(rgb: Float32Array, w: number, h: number, settings: EnhanceSettings): Promise<Uint8Array> {
    const copy = new Float32Array(rgb)
    const message = await this.call({ id: 0, type: 'tiff', rgb: copy, w, h, settings }, [copy.buffer])
    if (message.type !== 'tiff') throw new Error('Die TIFF-Datei fehlt.')
    return new Uint8Array(message.buffer)
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
