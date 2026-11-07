/**
 * The bytes of a base64 string. `Uint8Array.from(text, mapFn)` calls the
 * mapping function once per byte and takes seconds for a document with
 * pictures in it; filling a preallocated array takes milliseconds.
 */
export function bytesFromBase64(base64) {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
