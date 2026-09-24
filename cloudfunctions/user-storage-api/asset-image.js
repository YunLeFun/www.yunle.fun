/** Bounded signature and encoded-dimension inspection for private asset sources. */
'use strict'

const { Buffer } = require('node:buffer')

const MAX_PIXELS = 100_000_000

function inspectAssetHeader(input, expectedType) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  let detectedType = ''
  let dimensions
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    detectedType = 'image/png'
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  else if (bytes.length >= 30 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    detectedType = 'image/webp'
    dimensions = webpDimensions(bytes)
  }
  else if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    detectedType = 'image/jpeg'
    dimensions = jpegDimensions(bytes)
  }
  else {
    const prefix = bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart()
    if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(prefix))
      detectedType = 'image/svg+xml'
  }
  if (detectedType !== expectedType)
    throw new Error('素材文件头与上传预留类型不匹配')
  if (detectedType !== 'image/svg+xml') {
    if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
      || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > MAX_PIXELS) {
      throw new Error('素材图片尺寸无效或超过像素上限')
    }
  }
  return { detectedType, ...dimensions }
}

function webpDimensions(bytes) {
  const format = bytes.subarray(12, 16).toString('ascii')
  if (format === 'VP8X') {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    }
  }
  if (format === 'VP8 ' && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A)
    return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF }
  if (format === 'VP8L' && bytes[20] === 0x2F) {
    const packed = bytes.readUInt32LE(21)
    return { width: (packed & 0x3FFF) + 1, height: ((packed >>> 14) & 0x3FFF) + 1 }
  }
  return undefined
}

function jpegDimensions(bytes) {
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset++] !== 0xFF)
      return undefined
    while (offset < bytes.length && bytes[offset] === 0xFF)
      offset++
    if (offset >= bytes.length)
      return undefined
    const marker = bytes[offset++]
    if (marker === 0xD9 || marker === 0xDA)
      return undefined
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7))
      continue
    if (offset + 2 > bytes.length)
      return undefined
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length)
      return undefined
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (length < 8)
        return undefined
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return undefined
}

module.exports = { inspectAssetHeader, MAX_PIXELS }
