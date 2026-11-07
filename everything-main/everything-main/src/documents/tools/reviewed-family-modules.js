// Browser diagnostics use Vite's dependency URLs, including HMR timestamps,
// so the editor and its font oracle share preparation and availability caches.
export { openCanvasDocument } from '../src/engine/open-document.js';
export { CanvasEditor } from '../src/engine/canvas-editor.js';
export { setCanvasTextStyle, setCanvasFontAlternatives } from '../src/engine/canvas-text.js';
export { fontAvailable, checkFontAvailability } from '../src/engine/font-availability.js';
export { browseLocalFonts } from '../src/engine/local-fonts.js';
export { legacyGposFamily } from '../src/engine/gpos-only-kerning.js';
