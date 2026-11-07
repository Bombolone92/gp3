/** Encode bytes without constructing an intermediate binary string when the
 * runtime provides the native Uint8Array operation. Older runtimes retain the
 * chunked fallback, including standard alphabet and padding. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};
