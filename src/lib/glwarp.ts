import { warpRgba } from './image.ts'

type GLState = {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  program: WebGLProgram
  img: WebGLTexture
  field: WebGLTexture
  uniforms: {
    img: WebGLUniformLocation
    field: WebGLUniformLocation
    size: WebGLUniformLocation
    fieldSize: WebGLUniformLocation
    global: WebGLUniformLocation
    step: WebGLUniformLocation
    hasField: WebGLUniformLocation
  }
}

let state: GLState | null = null

const VERT = `#version 300 es
void main() {
  float x = (gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5) ? 1.0 : -1.0;
  float y = (gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5) ? 1.0 : -1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uField;
uniform vec2 uSize;
uniform vec2 uFieldSize;
uniform vec2 uGlobal;
uniform float uStep;
uniform float uHasField;
out vec4 o;

vec2 fieldAt(vec2 pix) {
  if (uHasField < 0.5) return vec2(0.0);
  vec2 f = clamp(pix / uStep - 0.5, vec2(0.0), uFieldSize - 1.0);
  vec2 i0 = floor(f);
  vec2 i1 = min(i0 + 1.0, uFieldSize - 1.0);
  vec2 t = f - i0;
  vec2 a = texture(uField, (i0 + 0.5) / uFieldSize).rg;
  vec2 b = texture(uField, (vec2(i1.x, i0.y) + 0.5) / uFieldSize).rg;
  vec2 c = texture(uField, (vec2(i0.x, i1.y) + 0.5) / uFieldSize).rg;
  vec2 d = texture(uField, (i1 + 0.5) / uFieldSize).rg;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

void main() {
  vec2 pix = vec2(gl_FragCoord.x - 0.5, uSize.y - gl_FragCoord.y - 0.5);
  vec2 samplePos = pix + uGlobal + fieldAt(pix);
  if (samplePos.x < 0.0 || samplePos.y < 0.0 || samplePos.x > uSize.x - 1.0 || samplePos.y > uSize.y - 1.0) {
    o = vec4(0.0);
    return;
  }
  o = texture(uImg, (samplePos + 0.5) / uSize);
  o.a = 1.0;
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Shader fehlt')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

function context(): GLState {
  if (state) return state
  const canvas = new OffscreenCanvas(4, 4)
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('WebGL2 fehlt')
  gl.getExtension('EXT_color_buffer_float')
  gl.getExtension('OES_texture_float_linear')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const program = gl.createProgram()
  if (!program) throw new Error('Programm fehlt')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Link fehlgeschlagen')
  }
  const img = gl.createTexture()
  const field = gl.createTexture()
  if (!img || !field) throw new Error('Textur fehlt')
  const loc = (name: string) => {
    const uniform = gl.getUniformLocation(program, name)
    if (!uniform) throw new Error(`Uniform ${name} fehlt`)
    return uniform
  }
  state = {
    canvas,
    gl,
    program,
    img,
    field,
    uniforms: {
      img: loc('uImg'),
      field: loc('uField'),
      size: loc('uSize'),
      fieldSize: loc('uFieldSize'),
      global: loc('uGlobal'),
      step: loc('uStep'),
      hasField: loc('uHasField'),
    },
  }
  return state
}

function uploadTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  target: number,
  filter: number,
) {
  gl.activeTexture(target)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

export function warpRgbaGL(
  src: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  dx: number,
  dy: number,
  field: Float32Array | null,
  fw: number,
  fh: number,
  step: number,
): Uint8Array {
  const gpu = context()
  const { gl } = gpu
  if (gpu.canvas.width !== w) gpu.canvas.width = w
  if (gpu.canvas.height !== h) gpu.canvas.height = h
  gl.viewport(0, 0, w, h)
  gl.disable(gl.BLEND)
  gl.useProgram(gpu.program)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  uploadTexture(gl, gpu.img, gl.TEXTURE0, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src)

  const fieldW = field && fw > 0 ? fw : 1
  const fieldH = field && fh > 0 ? fh : 1
  const packed = new Float32Array(fieldW * fieldH * 4)
  if (field && fw > 0 && fh > 0) {
    for (let i = 0; i < fw * fh; i++) {
      packed[i * 4] = field[i * 2] ?? 0
      packed[i * 4 + 1] = field[i * 2 + 1] ?? 0
    }
  }
  uploadTexture(gl, gpu.field, gl.TEXTURE1, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldW, fieldH, 0, gl.RGBA, gl.FLOAT, packed)

  gl.uniform1i(gpu.uniforms.img, 0)
  gl.uniform1i(gpu.uniforms.field, 1)
  gl.uniform2f(gpu.uniforms.size, w, h)
  gl.uniform2f(gpu.uniforms.fieldSize, fieldW, fieldH)
  gl.uniform2f(gpu.uniforms.global, dx, dy)
  gl.uniform1f(gpu.uniforms.step, step > 0 ? step : 1)
  gl.uniform1f(gpu.uniforms.hasField, field && fw > 0 ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  const raw = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
  const out = new Uint8Array(w * h * 4)
  const row = w * 4
  for (let y = 0; y < h; y++) {
    out.set(raw.subarray((h - 1 - y) * row, (h - y) * row), y * row)
  }
  return out
}

function meanAbs(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  let err = 0
  let n = 0
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const p = (y * w + x) * 4
      err += Math.abs((a[p] ?? 0) - (b[p] ?? 0))
      err += Math.abs((a[p + 1] ?? 0) - (b[p + 1] ?? 0))
      err += Math.abs((a[p + 2] ?? 0) - (b[p + 2] ?? 0))
      err += Math.abs((a[p + 3] ?? 0) - (b[p + 3] ?? 0))
      n += 4
    }
  }
  return n ? err / n : 999
}

/** Enables the GPU warp only when it matches the CPU sampler. */
export function glWarpMatchesCpu(): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false
  const w = 24
  const h = 24
  const src = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      src[p] = (x * 17) % 255
      src[p + 1] = (y * 29) % 255
      src[p + 2] = (x * 3 + y * 5) % 255
      src[p + 3] = 255
    }
  }
  const plainCpu = warpRgba(src, w, h, 2.5, -1.25, null, 0, 0, 8)
  const plainGl = warpRgbaGL(src, w, h, 2.5, -1.25, null, 0, 0, 8)
  if (meanAbs(plainCpu, plainGl, w, h) > 2) return false
  const fw = 3
  const fh = 3
  const field = new Float32Array(fw * fh * 2)
  for (let i = 0; i < fw * fh; i++) {
    field[i * 2] = 1
    field[i * 2 + 1] = -0.5
  }
  const fieldCpu = warpRgba(src, w, h, 0.25, 0.25, field, fw, fh, 8)
  const fieldGl = warpRgbaGL(src, w, h, 0.25, 0.25, field, fw, fh, 8)
  return meanAbs(fieldCpu, fieldGl, w, h) < 2.5
}
