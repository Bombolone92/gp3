import { vi } from 'vitest';

// Browser APIs the real editor chrome uses but jsdom lacks, for tests that
// boot src/main.js into the editor view instead of mocking it. The canvas
// context records nothing: these tests check routing and saving, not pixels.
export function stubEditorBrowser() {
  vi.stubGlobal('matchMedia', query => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return context2d(this); });
}

function context2d(canvas) {
  const values = { canvas, globalAlpha: 1, lineWidth: 1, font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const results = {
    measureText: text => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({ setTransform() {} }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  return new Proxy(values, {
    get: (target, key) => key in target ? target[key] : results[key] || (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}
