declare module "snappyjs" {
  type SnappyBuffer = Uint8Array | ArrayBuffer;
  export function compress(data: SnappyBuffer): SnappyBuffer;
  export function uncompress(data: SnappyBuffer): SnappyBuffer;
}
