// 读取 WOFF2 字体的 cmap，返回字体能渲染的 Unicode 码点集合。
// 只依赖 Node 内置 brotli：WOFF2 把所有表拼成一条 brotli 流，cmap 从不做变换，
// 解压后按表目录顺序累加长度即可定位，无需还原 glyf / loca。
import { brotliDecompressSync } from 'node:zlib'

const WOFF2_SIGNATURE = 0x774F4632 // 'wOF2'
const CMAP_TAG_INDEX = 0
const GLYF_TAG_INDEX = 10
const LOCA_TAG_INDEX = 11
const ARBITRARY_TAG = 63

function readBase128(view, state) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    const byte = view.getUint8(state.offset++)
    value = (value << 7) | (byte & 0x7F)
    if ((byte & 0x80) === 0)
      return value >>> 0
  }
  throw new Error('WOFF2: invalid UIntBase128')
}

function readCmapCodePoints(cmap) {
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength)
  const numTables = view.getUint16(2)
  const subtables = []
  for (let i = 0; i < numTables; i++) {
    const record = 4 + i * 8
    const platformId = view.getUint16(record)
    const encodingId = view.getUint16(record + 2)
    const offset = view.getUint32(record + 4)
    const format = view.getUint16(offset)
    const unicode = platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10))
    if (unicode && (format === 4 || format === 12))
      subtables.push({ format, offset })
  }
  // 优先 format 12（覆盖增补平面），否则用 format 4。
  const subtable = subtables.find(table => table.format === 12) ?? subtables.find(table => table.format === 4)
  if (!subtable)
    throw new Error('WOFF2: no Unicode cmap subtable')

  const codePoints = new Set()
  const { format, offset } = subtable
  if (format === 12) {
    const groups = view.getUint32(offset + 12)
    for (let i = 0; i < groups; i++) {
      const group = offset + 16 + i * 12
      const start = view.getUint32(group)
      const end = view.getUint32(group + 4)
      const startGlyph = view.getUint32(group + 8)
      for (let code = start; code <= end; code++) {
        if (startGlyph + code - start !== 0)
          codePoints.add(code)
      }
    }
    return codePoints
  }

  const segCount = view.getUint16(offset + 6) / 2
  const endCodes = offset + 14
  const startCodes = endCodes + segCount * 2 + 2
  const idDeltas = startCodes + segCount * 2
  const idRangeOffsets = idDeltas + segCount * 2
  for (let segment = 0; segment < segCount; segment++) {
    const start = view.getUint16(startCodes + segment * 2)
    const end = view.getUint16(endCodes + segment * 2)
    const delta = view.getInt16(idDeltas + segment * 2)
    const rangeOffsetPosition = idRangeOffsets + segment * 2
    const rangeOffset = view.getUint16(rangeOffsetPosition)
    for (let code = start; code <= end && code !== 0xFFFF; code++) {
      let glyph
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xFFFF
      }
      else {
        glyph = view.getUint16(rangeOffsetPosition + rangeOffset + (code - start) * 2)
        if (glyph !== 0)
          glyph = (glyph + delta) & 0xFFFF
      }
      if (glyph !== 0)
        codePoints.add(code)
    }
  }
  return codePoints
}

/**
 * @param {Uint8Array} buffer WOFF2 文件内容
 * @returns {Set<number>} 有字形的 Unicode 码点
 */
export function readWoff2CodePoints(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.getUint32(0) !== WOFF2_SIGNATURE)
    throw new Error('WOFF2: bad signature')
  const numTables = view.getUint16(12)
  const totalCompressedSize = view.getUint32(20)

  const state = { offset: 48 }
  let cmapStart = -1
  let cmapLength = 0
  let streamOffset = 0
  for (let i = 0; i < numTables; i++) {
    const flags = view.getUint8(state.offset++)
    const tagIndex = flags & 0x3F
    const transform = flags >> 6
    if (tagIndex === ARBITRARY_TAG)
      state.offset += 4
    const origLength = readBase128(view, state)
    // glyf / loca 的变换版本 0 表示「已变换」，其余表反之。
    const isGlyfOrLoca = tagIndex === GLYF_TAG_INDEX || tagIndex === LOCA_TAG_INDEX
    const transformed = isGlyfOrLoca ? transform !== 3 : transform !== 0
    const length = transformed ? readBase128(view, state) : origLength
    if (tagIndex === CMAP_TAG_INDEX) {
      cmapStart = streamOffset
      cmapLength = length
    }
    streamOffset += length
  }
  if (cmapStart < 0)
    throw new Error('WOFF2: missing cmap table')
  if (view.getUint32(4) === 0x74746366) // 'ttcf'
    throw new Error('WOFF2: font collections are not supported')

  const stream = brotliDecompressSync(buffer.subarray(state.offset, state.offset + totalCompressedSize))
  return readCmapCodePoints(stream.subarray(cmapStart, cmapStart + cmapLength))
}
