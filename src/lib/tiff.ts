/** Uncompressed 16-bit RGB TIFF, little-endian, one strip. */
export function encodeTiff16(rgb: Float32Array, w: number, h: number): Uint8Array {
  const ifdCount = 11
  const ifdOffset = 16
  const ifdBytes = 2 + ifdCount * 12 + 4
  const dataOffset = ifdOffset + ifdBytes
  const imageBytes = w * h * 6
  const buffer = new ArrayBuffer(dataOffset + imageBytes)
  const view = new DataView(buffer)

  view.setUint8(0, 0x49)
  view.setUint8(1, 0x49)
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(8, 16, true)
  view.setUint16(10, 16, true)
  view.setUint16(12, 16, true)

  let cursor = ifdOffset
  view.setUint16(cursor, ifdCount, true)
  cursor += 2
  const write = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(cursor, tag, true)
    view.setUint16(cursor + 2, type, true)
    view.setUint32(cursor + 4, count, true)
    view.setUint32(cursor + 8, value, true)
    cursor += 12
  }
  const SHORT = 3
  const LONG = 4
  write(256, LONG, 1, w)
  write(257, LONG, 1, h)
  write(258, SHORT, 3, 8)
  write(259, SHORT, 1, 1)
  write(262, SHORT, 1, 2)
  write(273, LONG, 1, dataOffset)
  write(277, SHORT, 1, 3)
  write(278, LONG, 1, h)
  write(279, LONG, 1, imageBytes)
  write(284, SHORT, 1, 1)
  write(339, SHORT, 1, 1)
  view.setUint32(cursor, 0, true)

  let offset = dataOffset
  for (let i = 0; i < rgb.length; i++) {
    const sample = Math.round(Math.min(1, Math.max(0, rgb[i] ?? 0)) * 65535)
    view.setUint16(offset, sample, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}
