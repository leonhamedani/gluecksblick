import { alignKept } from '../lib/align.ts'
import { enhanceImage, floatRgbToRgba, type EnhanceSettings } from '../lib/enhance.ts'
import { glWarpMatchesCpu, warpRgbaGL } from '../lib/glwarp.ts'
import { scoreGrayU8, warpRgba } from '../lib/image.ts'
import type { WorkerRequest } from '../lib/messages.ts'
import { accumulateMean, finalizeMean, sigmaClip, warpFrame, type Warper } from '../lib/stack.ts'
import { encodeTiff16 } from '../lib/tiff.ts'

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: object, transfer?: Transferable[]) => void
}

const scope = globalThis as unknown as WorkerScope

function post(message: object, transfer?: Transferable[]) {
  if (transfer) scope.postMessage(message, transfer)
  else scope.postMessage(message)
}

let warper: Warper = warpRgba
let accel: 'webgl' | 'cpu' = 'cpu'
try {
  if (glWarpMatchesCpu()) {
    warper = warpRgbaGL
    accel = 'webgl'
  }
} catch {
  warper = warpRgba
  accel = 'cpu'
}

type StackState = {
  w: number
  h: number
  mode: 'mean' | 'sigma'
  kappa: number
  sum: Float32Array
  count: Float32Array
  frames: Uint8Array[]
  used: number
}

let stack: StackState | null = null

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'score') {
      const scores = msg.grays.map((gray, index) => {
        if (index % 2 === 0) {
          post({
            id: msg.id,
            type: 'progress',
            ratio: index / Math.max(1, msg.grays.length),
            label: 'Schärfe wird gemessen',
          })
        }
        return scoreGrayU8(gray, msg.w, msg.h)
      })
      post({ id: msg.id, type: 'score', scores })
      return
    }
    if (msg.type === 'align') {
      const result = alignKept(msg.grays, msg.w, msg.h, msg.kept, msg.scores, msg.options, (ratio, label) => {
        post({ id: msg.id, type: 'progress', ratio, label })
      })
      post({ id: msg.id, type: 'align', shifts: result.shifts })
      return
    }
    if (msg.type === 'stack-init') {
      stack = {
        w: msg.w,
        h: msg.h,
        mode: msg.mode,
        kappa: msg.kappa,
        sum: new Float32Array(msg.w * msg.h * 3),
        count: new Float32Array(msg.w * msg.h),
        frames: [],
        used: 0,
      }
      post({ id: msg.id, type: 'ack' })
      return
    }
    if (msg.type === 'stack-add') {
      if (!stack) throw new Error('Der Stapel ist noch nicht vorbereitet.')
      if (!msg.shift.rejected) {
        const warped = warpFrame(msg.rgba, stack.w, stack.h, msg.shift, warper)
        if (stack.mode === 'sigma') stack.frames.push(warped)
        else accumulateMean(stack.sum, stack.count, warped)
        stack.used++
      }
      post({ id: msg.id, type: 'ack' })
      return
    }
    if (msg.type === 'stack-finish') {
      if (!stack) throw new Error('Der Stapel ist noch nicht vorbereitet.')
      const rgb =
        stack.mode === 'sigma'
          ? sigmaClip(stack.frames, stack.w, stack.h, stack.kappa)
          : finalizeMean(stack.sum, stack.count)
      const used = stack.used
      stack = null
      post({ id: msg.id, type: 'stack', rgb, used }, [rgb.buffer])
      return
    }
    if (msg.type === 'enhance') {
      const rgba = preview(msg.rgb, msg.w, msg.h, msg.settings)
      post({ id: msg.id, type: 'preview', rgba }, [rgba.buffer])
      return
    }
    if (msg.type === 'tiff') {
      const tiff = encodeTiff16(enhanceImage(msg.rgb, msg.w, msg.h, msg.settings), msg.w, msg.h)
      post({ id: msg.id, type: 'tiff', buffer: tiff.buffer }, [tiff.buffer])
      return
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Die Rechnung wurde unterbrochen.'
    post({ id: msg.id, type: 'error', message })
  }
}

function preview(rgb: Float32Array, w: number, h: number, settings: EnhanceSettings): Uint8ClampedArray {
  return floatRgbToRgba(enhanceImage(rgb, w, h, settings))
}

post({ type: 'ready', accel })
