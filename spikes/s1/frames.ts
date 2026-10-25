/**
 * Synthetic 1280x800 JPEG frames for the S1 transport spike.
 *
 * The spike measures transport, not encoding: frames are encoded once and
 * cycled. Content still moves (and the frame index is drawn) so a human can
 * confirm the canvas is live, and the noise keeps JPEG size near a real
 * screencast instead of a trivial gradient.
 */
import jpeg from 'jpeg-js'

export const FRAME_WIDTH = 1280
export const FRAME_HEIGHT = 800
export const FRAME_QUALITY = 70
export const FRAME_COUNT = 6

export interface EncodedFrame {
  index: number
  width: number
  height: number
  bytes: Uint8Array
}

/** Five-row block digits, enough to stamp the frame number on the canvas. */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
}

/**
 * Paint one frame into an RGBA buffer.
 * @param data - destination RGBA buffer.
 * @param frame - frame ordinal; also drives the moving block.
 */
function paint(data: Uint8Array, frame: number): void {
  const w = FRAME_WIDTH
  const h = FRAME_HEIGHT
  const boxX = 48 + frame * 150
  const boxY = 120 + frame * 64
  for (let y = 0; y < h; y++) {
    const v = y / h
    for (let x = 0; x < w; x++) {
      const u = x / w
      let r = 18 + u * 34 + v * 10
      let g = 24 + v * 46 + u * 8
      let b = 40 + u * 52 + v * 22

      // Card surfaces, so large areas have realistic block edges.
      if (x > 56 && x < 660 && y > 48 && y < 300) {
        r = 30 + u * 20
        g = 36 + v * 24
        b = 52 + u * 24
      }
      if (x > 700 && x < 1230 && y > 420 && y < 760) {
        r = 27 + v * 26
        g = 33 + u * 30
        b = 48 + v * 36
      }

      // Grid lines.
      if (x % 80 === 0 || y % 80 === 0) {
        r += 10
        g += 12
        b += 14
      }

      // Moving accent block plus a progress underline.
      if (x >= boxX && x < boxX + 230 && y >= boxY && y < boxY + 132) {
        r = 240
        g = 120 + frame * 14
        b = 58
      }
      const barStart = 56 + frame * 180
      if (y >= 772 && y < 792 && x >= barStart && x < barStart + 210) {
        r = 88
        g = 208
        b = 232
      }

      // Sparse deterministic noise keeps q70 size realistic.
      const n = ((x * 374761393) ^ (y * 668265263) ^ (frame * 2246822519)) >>> 0
      if ((n & 7) === 0) {
        const d = (n & 31) - 16
        r += d
        g += d
        b += d
      }

      const o = (y * w + x) * 4
      data[o] = clamp(r)
      data[o + 1] = clamp(g)
      data[o + 2] = clamp(b)
      data[o + 3] = 255
    }
  }

  // Frame number in the top-left, 5x7 cells of 12px.
  const text = String(frame)
  let cursor = 24
  for (const ch of text) {
    const rows = DIGITS[ch] ?? DIGITS['0']
    for (let ry = 0; ry < rows.length; ry++) {
      for (let rx = 0; rx < rows[ry].length; rx++) {
        if (rows[ry][rx] !== '1') continue
        fillRect(data, cursor + rx * 12, 24 + ry * 12, 12, 12, 245, 245, 245)
      }
    }
    cursor += 4 * 12 + 8
  }
}

/**
 * Fill one rectangle in the RGBA buffer.
 */
function fillRect(data: Uint8Array, x0: number, y0: number, rw: number, rh: number, r: number, g: number, b: number): void {
  for (let y = y0; y < Math.min(y0 + rh, FRAME_HEIGHT); y++) {
    for (let x = x0; x < Math.min(x0 + rw, FRAME_WIDTH); x++) {
      const o = (y * FRAME_WIDTH + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value | 0
}

/**
 * Encode the cycled frame set. Called once per host process.
 * @param count - number of distinct frames.
 * @returns encoded JPEGs in display order.
 */
export function generateFrames(count = FRAME_COUNT): EncodedFrame[] {
  const data = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 4)
  const frames: EncodedFrame[] = []
  for (let i = 0; i < count; i++) {
    paint(data, i)
    const encoded = jpeg.encode({ width: FRAME_WIDTH, height: FRAME_HEIGHT, data }, FRAME_QUALITY)
    frames.push({
      index: i,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      bytes: new Uint8Array(encoded.data),
    })
  }
  return frames
}
