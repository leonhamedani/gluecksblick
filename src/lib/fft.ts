/** In-place radix-2 FFT. Forward uses the sign convention exp(-i·2π). */

export function nextPow2(n: number): number {
  let p = 1
  const target = Math.max(1, Math.ceil(n))
  while (p < target) p <<= 1
  return p
}

function isPow2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0
}

export function fftComplex(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  if (im.length !== n || !isPow2(n)) {
    throw new Error('FFT-Länge muss eine Zweierpotenz sein.')
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((2 * Math.PI) / len) * (inverse ? 1 : -1)
    const wlenRe = Math.cos(angle)
    const wlenIm = Math.sin(angle)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]
        const uIm = im[i + j]
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + half] = uRe - vRe
        im[i + j + half] = uIm - vIm
        const nextRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextRe
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

export function fft2(
  re: Float64Array,
  im: Float64Array,
  w: number,
  h: number,
  inverse: boolean,
): void {
  if (!isPow2(w) || !isPow2(h) || re.length !== w * h || im.length !== re.length) {
    throw new Error('2D-FFT braucht Zweierpotenzen.')
  }
  const rowRe = new Float64Array(w)
  const rowIm = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    const off = y * w
    for (let x = 0; x < w; x++) {
      rowRe[x] = re[off + x]
      rowIm[x] = im[off + x]
    }
    fftComplex(rowRe, rowIm, inverse)
    for (let x = 0; x < w; x++) {
      re[off + x] = rowRe[x]
      im[off + x] = rowIm[x]
    }
  }
  const colRe = new Float64Array(h)
  const colIm = new Float64Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colRe[y] = re[y * w + x]
      colIm[y] = im[y * w + x]
    }
    fftComplex(colRe, colIm, inverse)
    for (let y = 0; y < h; y++) {
      re[y * w + x] = colRe[y]
      im[y * w + x] = colIm[y]
    }
  }
}
