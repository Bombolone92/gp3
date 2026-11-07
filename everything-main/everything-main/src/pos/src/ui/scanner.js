/**
 * Camera barcode scanning, for tablets and phones with no hardware scanner.
 *
 * Progressive enhancement: the caller only shows the entry point when
 * cameraScanSupported() is true. Single-shot by design - the first code wins,
 * the camera is released, and the dialog closes. A continuously running
 * detector pointed at one label would otherwise add the same item twenty
 * times a second.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { SCAN_FORMATS } from '../lib/scan.js';

/** How often to ask the detector for codes. Fast enough to feel instant. */
const DETECT_INTERVAL_MS = 220;

/**
 * openCameraScanner({ title, hint, onCode })
 * onCode(rawValue) runs after the dialog closes and the camera is released.
 */
export function openCameraScanner({
  title = 'Scan barcode',
  hint = 'Hold the barcode inside the frame',
  onCode,
} = {}) {
  const video = el('video.scan-video', {
    autoplay: true, muted: true, playsInline: true, 'aria-hidden': 'true',
  });
  const stage = el('div.scan-stage', {}, video, el('div.scan-reticle', { 'aria-hidden': 'true' }));
  const status = el('div.scan-status', { role: 'status' }, hint);
  const body = el('div.scan-body', {}, stage, status);

  let stream = null;
  let timer = null;
  let stopped = false;
  let busy = false;

  /** Release the camera. Called on close, on success, and on any failure. */
  function stop() {
    stopped = true;
    clearInterval(timer);
    timer = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
    video.srcObject = null;
  }

  const modal = openModal({ title, content: body, onClose: stop });

  function fail(message) {
    stop();
    clear(status);
    status.classList.add('scan-status-error');
    status.append(el('span', {}, message));
    stage.classList.add('scan-stage-off');
    stage.append(el('div.scan-off-ic', { html: icon('cameraOff', 26, 1.8) }));
  }

  (async () => {
    let detector;
    try {
      // Ask only for formats this build knows; an unsupported list throws.
      const supported = await window.BarcodeDetector.getSupportedFormats?.() ?? [];
      const formats = SCAN_FORMATS.filter((f) => !supported.length || supported.includes(f));
      detector = formats.length ? new window.BarcodeDetector({ formats }) : new window.BarcodeDetector();
    } catch (err) {
      console.error(err);
      fail('This browser can’t scan barcodes. Type the SKU instead.');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
    } catch (err) {
      console.error(err);
      fail(err?.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow it in your browser settings to scan.'
        : 'No camera available. Type the SKU instead.');
      return;
    }

    // The dialog can be dismissed while the permission prompt is up.
    if (stopped) { stop(); return; }
    video.srcObject = stream;
    video.play?.().catch(() => {});

    timer = setInterval(async () => {
      if (stopped || busy || video.readyState < 2) return;
      busy = true;
      let codes = [];
      try {
        codes = await detector.detect(video);
      } catch {
        // Transient decode failures are normal while focusing; keep going.
      }
      busy = false;
      const raw = codes.map((c) => String(c?.rawValue ?? '').trim()).find(Boolean);
      if (!raw || stopped) return;
      stop();
      modal.close();
      onCode?.(raw);
    }, DETECT_INTERVAL_MS);
  })();

  return modal;
}
