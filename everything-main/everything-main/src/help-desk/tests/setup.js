import 'fake-indexeddb/auto';

// jsdom lacks a few browser APIs the app touches.
if (typeof window !== 'undefined') installBrowserShims();

function installBrowserShims() {
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; this.dispatchEvent(new Event('close')); };
}
if (!window.scrollTo) window.scrollTo = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
