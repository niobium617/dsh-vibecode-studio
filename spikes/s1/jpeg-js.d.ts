declare module 'jpeg-js' {
  export interface EncodeOptions {
    width: number
    height: number
    data: Uint8Array
  }
  export interface EncodeResult {
    data: Buffer
    width: number
    height: number
  }
  export function encode(input: EncodeOptions, quality?: number): EncodeResult
  const jpeg: { encode: typeof encode }
  export default jpeg
}
