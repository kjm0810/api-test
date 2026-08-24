import { uncompress } from "snappyjs";

export function decodeEvent<T>(payload: ArrayBuffer): T {
  const bytes = new Uint8Array(uncompress(payload) as ArrayBuffer);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
