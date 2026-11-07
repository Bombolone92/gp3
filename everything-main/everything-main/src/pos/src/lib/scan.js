/**
 * Barcode input.
 *
 * Two sources, one destination (an exact SKU lookup):
 *
 *  - Keyboard-wedge scanners (the USB/Bluetooth kind every shop owns) present
 *    as keyboards. They "type" a code far faster than a human can and finish
 *    with Enter (some with Tab). Timing is what tells the two apart: a wedge
 *    keeps well under WEDGE_MAX_GAP_MS between characters, while even a fast
 *    typist is several times slower.
 *
 *  - The camera, where BarcodeDetector exists (see ui/scanner.js).
 *
 * This module stays DOM-free so the timing rules can be tested directly.
 */

/** Inter-key gap a wedge stays under. ~25 chars/second is not hand-typed. */
export const WEDGE_MAX_GAP_MS = 40;
/** Shorter bursts are ignored: too easy to produce by accident. */
export const WEDGE_MIN_LENGTH = 4;

/**
 * Recognize wedge bursts in a stream of keydown events.
 *
 * createWedgeReader({ onScan }) → { handle(event, now?), reset() }
 *
 * handle() returns true when the event completed a scan, so the caller can
 * preventDefault() and keep the terminator out of the page.
 */
export function createWedgeReader({
  maxGap = WEDGE_MAX_GAP_MS,
  minLength = WEDGE_MIN_LENGTH,
  onScan,
} = {}) {
  let buffer = '';
  /** Timestamp of the previous character, or null when no burst is running. */
  let last = null;

  const reset = () => { buffer = ''; last = null; };

  return {
    reset,
    /** Current burst, for tests and debugging. */
    get buffer() { return buffer; },
    handle(e, now = e.timeStamp || 0) {
      // A shortcut is never part of a code.
      if (e.ctrlKey || e.metaKey || e.altKey) { reset(); return false; }

      if (e.key === 'Enter' || e.key === 'Tab') {
        const code = buffer;
        reset();
        if (code.length >= minLength) {
          onScan?.(code);
          return true;
        }
        return false;
      }

      // Modifier and navigation keys pass through without breaking the burst:
      // scanners press Shift for uppercase characters.
      if (e.key === undefined || e.key.length !== 1) return false;

      const fast = last !== null && now - last <= maxGap;
      buffer = fast ? buffer + e.key : e.key;
      last = now;
      return false;
    },
  };
}

/** Products whose SKU is exactly `code`, case- and whitespace-insensitive. */
export function findBySku(products, code) {
  const needle = String(code ?? '').trim().toLowerCase();
  if (!needle) return [];
  return (products || []).filter((p) => String(p?.sku ?? '').trim().toLowerCase() === needle);
}

/**
 * Whether a typed search string is shaped like a scanned code rather than a
 * word - the difference between offering "create a product with this SKU" and
 * quietly leaving a fruitless search alone.
 */
export function looksLikeBarcode(text) {
  const s = String(text ?? '').trim();
  if (s.length < 6 || /\s/.test(s)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) return false;
  return (s.match(/\d/g) || []).length >= 4;
}

/** Formats worth asking BarcodeDetector for: retail labels, plus QR. */
export const SCAN_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93',
  'itf', 'codabar', 'qr_code', 'data_matrix',
];

/** True when this browser can scan with the camera at all. */
export function cameraScanSupported() {
  return typeof window !== 'undefined'
    && typeof window.BarcodeDetector === 'function'
    && !!navigator.mediaDevices?.getUserMedia;
}
