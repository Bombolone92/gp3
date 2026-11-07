// Test environment shims: jsdom lacks Path2D, canvas contexts and ResizeObserver.
class Path2DStub {
  constructor() {
    this.ops = [];
  }
  moveTo(...a) { this.ops.push(['M', ...a]); }
  lineTo(...a) { this.ops.push(['L', ...a]); }
  bezierCurveTo(...a) { this.ops.push(['C', ...a]); }
  closePath() { this.ops.push(['Z']); }
  rect(...a) { this.ops.push(['R', ...a]); }
  addPath(p) { this.ops.push(...(p?.ops || [])); }
}
if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = Path2DStub;
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
