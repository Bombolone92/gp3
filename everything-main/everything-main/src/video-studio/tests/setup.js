// jsdom lacks a few browser APIs the app touches.
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:test';
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = window.matchMedia;
}
if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = function setPointerCapture() {};
// Keep main.js from booting the app when a test imports it.
window.__VIDEO_STUDIO_TEST__ = true;
// jsdom has no canvas backend and logs "Not implemented" for every context; the app copes with null.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
};
