// Boots the full app in jsdom with a stub 2D context, for shell and a11y tests.
import { App } from '../src/app.js';
import { Prefs } from '../src/prefs.js';

/** Polygons from a Path2D stub's ops (curves approximated by their end points and controls). */
function polygons(path) {
  const polys = [];
  let cur = null;
  for (const [op, ...a] of path?.ops || []) {
    if (op === 'M') polys.push((cur = [[a[0], a[1]]]));
    else if (op === 'L') cur?.push([a[0], a[1]]);
    else if (op === 'C') {
      const [x0, y0] = cur[cur.length - 1];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        cur.push([
          mt ** 3 * x0 + 3 * mt * mt * t * a[0] + 3 * mt * t * t * a[2] + t ** 3 * a[4],
          mt ** 3 * y0 + 3 * mt * mt * t * a[1] + 3 * mt * t * t * a[3] + t ** 3 * a[5],
        ]);
      }
    } else if (op === 'R') polys.push([[a[0], a[1]], [a[0] + a[2], a[1]], [a[0] + a[2], a[1] + a[3]], [a[0], a[1] + a[3]], [a[0], a[1]]]);
  }
  return polys;
}

function pointInPath(path, x, y) {
  let inside = false;
  for (const poly of polygons(path)) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distanceToPath(path, x, y) {
  let best = Infinity;
  for (const poly of polygons(path)) {
    for (let i = 0; i < poly.length - 1; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

function stubContext(canvas) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    {
      canvas,
      measureText: (t) => ({ width: String(t).length * 6, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      isPointInPath: (path, x, y) => pointInPath(path, x, y),
      isPointInStroke(path, x, y) {
        return distanceToPath(path, x, y) <= (this.lineWidth || 1) / 2;
      },
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        return noop;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
}

export function installCanvasStub() {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this._ctx) this._ctx = stubContext(this);
    return this._ctx;
  };
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    globalThis.OffscreenCanvas = class {
      constructor(w, h) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        if (!this._ctx) this._ctx = stubContext(this);
        return this._ctx;
      }
    };
  }
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
  if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

export async function bootAppWithFeatures(opts = {}) {
  const { installFeatures } = await import('../src/features.js');
  return bootApp({ ...opts, install: installFeatures });
}

export function bootApp({ env = 'web', user = null, install = null } = {}) {
  installCanvasStub();
  document.body.innerHTML = '<div id="app" class="app"></div><div id="live-region" aria-live="polite"></div>';
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const app = new App(document.getElementById('app'), { prefs: new Prefs(storage), env, user, onSignOut: () => {} });
  install?.(app);
  app.start();
  return app;
}
