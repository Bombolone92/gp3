// Test environment shims: jsdom has no ResizeObserver, matchMedia or WebGL.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
