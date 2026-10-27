/**
 * Minimal PNG decoder for screenshot assertions (T017).
 *
 * Chromium screenshots are 8-bit, non-interlaced RGB/RGBA PNGs. Decoding just
 * those forms keeps pixel checks dependency-free; anything else fails loudly
 * instead of silently comparing bytes.
 */
import { inflateSync } from 'node:zlib'

export interface RgbaImage {
  readonly width: number
  readonly height: number
  /** Row-major RGBA bytes, four per pixel. */
  readonly data: Uint8Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  )
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('decodePng: not a PNG')
  }

  let offset = SIGNATURE.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Uint8Array[] = []

  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset)
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) throw new Error('decodePng: truncated chunk')
    const chunk = bytes.subarray(start, end)
    if (type === 'IHDR') {
      width = readU32(chunk, 0)
      height = readU32(chunk, 4)
      bitDepth = chunk[8]!
      colorType = chunk[9]!
      interlace = chunk[12]!
    } else if (type === 'IDAT') {
      idat.push(chunk)
    } else if (type === 'IEND') {
      break
    }
    offset = end + 4
  }

  if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth}`)
  if (interlace !== 0) throw new Error('decodePng: interlaced PNGs are not supported')
  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const channels = channelsByColorType[colorType]
  if (!channels) throw new Error(`decodePng: unsupported color type ${colorType}`)
  if (idat.length === 0) throw new Error('decodePng: missing IDAT')

  const inflated = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))))
  const stride = width * channels
  if (inflated.length < (stride + 1) * height) throw new Error('decodePng: truncated pixel data')

  const data = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  let cursor = 0

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor]!
    cursor += 1
    const line = inflated.subarray(cursor, cursor + stride)
    cursor += stride
    const current = new Uint8Array(stride)

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels]! : 0
      const up = previous[i]!
      const upLeft = i >= channels ? previous[i - channels]! : 0
      let value = line[i]!
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) value += paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`decodePng: unsupported filter ${filter}`)
      current[i] = value & 0xff
    }

    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4
      const source = x * channels
      if (colorType === 6) {
        data[target] = current[source]!
        data[target + 1] = current[source + 1]!
        data[target + 2] = current[source + 2]!
        data[target + 3] = current[source + 3]!
      } else if (colorType === 2) {
        data[target] = current[source]!
        data[target + 1] = current[source + 1]!
        data[target + 2] = current[source + 2]!
        data[target + 3] = 255
      } else if (colorType === 4) {
        data[target] = current[source]!
        data[target + 1] = current[source]!
        data[target + 2] = current[source]!
        data[target + 3] = current[source + 1]!
      } else {
        data[target] = current[source]!
        data[target + 1] = current[source]!
        data[target + 2] = current[source]!
        data[target + 3] = 255
      }
    }

    previous = current
  }

  return { width, height, data }
}

export function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw new Error(`pixelAt: (${x}, ${y}) is outside ${image.width}x${image.height}`)
  }
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ]
}

/** Counts pixels below `threshold` luminance inside an optional region. */
export function countDarkPixels(
  image: RgbaImage,
  region: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  },
  threshold = 120,
): number {
  let count = 0
  const xEnd = Math.min(region.x + region.width, image.width)
  const yEnd = Math.min(region.y + region.height, image.height)
  for (let y = Math.max(region.y, 0); y < yEnd; y += 1) {
    for (let x = Math.max(region.x, 0); x < xEnd; x += 1) {
      const [red, green, blue] = pixelAt(image, x, y)
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      if (luminance < threshold) count += 1
    }
  }
  return count
}
