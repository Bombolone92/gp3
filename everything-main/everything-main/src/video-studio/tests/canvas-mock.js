// A recording 2D canvas context for drawing tests in jsdom (which has no
// canvas backend). Every call is logged; numeric arguments must be finite.

export function mockContext() {
  const calls = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif' };
  const bad = [];
  const gradient = () => ({ addColorStop(o, c) { calls.push(['addColorStop', o, c]); if (!Number.isFinite(o) || o < 0 || o > 1) bad.push(['addColorStop', o]); } });
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'bad') return bad;
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (text) => ({ width: String(text).length * 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') {
        return (...args) => {
          calls.push([prop, ...args]);
          if (args.some((a) => !Number.isFinite(a))) bad.push([prop, ...args]);
          return gradient();
        };
      }
      if (prop === 'getImageData' || prop === 'createImageData') return (x, y, w, hh) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) });
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (...args) => {
        calls.push([prop, ...args]);
        if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) bad.push([prop, ...args]);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push([`set:${String(prop)}`, value]);
      if (typeof value === 'number' && !Number.isFinite(value)) bad.push([`set:${String(prop)}`, value]);
      return true;
    },
  });
  return ctx;
}
