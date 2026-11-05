import type { EnhanceSettings } from './enhance.ts'
import type { FrameShift, ProcessOptions } from './align.ts'

export type ProgressFn = (ratio: number, label: string) => void

export type WorkerRequest =
  | { id: number; type: 'score'; w: number; h: number; grays: Uint8Array[] }
  | {
      id: number
      type: 'align'
      w: number
      h: number
      grays: Uint8Array[]
      scores: number[]
      kept: number[]
      options: ProcessOptions
    }
  | { id: number; type: 'stack-init'; w: number; h: number; mode: 'mean' | 'sigma'; kappa: number }
  | { id: number; type: 'stack-add'; rgba: Uint8Array; shift: FrameShift }
  | { id: number; type: 'stack-finish' }
  | { id: number; type: 'enhance'; rgb: Float32Array; w: number; h: number; settings: EnhanceSettings }
  | { id: number; type: 'tiff'; rgb: Float32Array; w: number; h: number; settings: EnhanceSettings }

export type WorkerResponse =
  | { id: number; type: 'progress'; ratio: number; label: string }
  | { id: number; type: 'score'; scores: number[] }
  | { id: number; type: 'align'; shifts: FrameShift[] }
  | { id: number; type: 'ack' }
  | { id: number; type: 'stack'; rgb: Float32Array; used: number }
  | { id: number; type: 'preview'; rgba: Uint8ClampedArray }
  | { id: number; type: 'tiff'; buffer: ArrayBuffer }
  | { id: number; type: 'error'; message: string }
  | { type: 'ready'; accel: 'webgl' | 'cpu' }
