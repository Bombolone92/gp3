// Measure SVG character-position proxies for the bounded controls below.
// These are not necessarily painted glyph origins: Garamond kerning provides
// counterexamples even when SVG and Canvas total advances agree. Validate
// intermediate positions against actual painting before diagnosing a renderer
// defect.
export async function captureReviewedFamilyEditor(page) {
  await page.evaluate(async () => {
    const { CanvasEditor } = await import('/tools/reviewed-family-modules.js');
    const original = CanvasEditor.prototype.relayout;
    window.reviewedFamilyEditor = null;
    CanvasEditor.prototype.relayout = function (...args) {
      const result = original.apply(this, args);
      window.reviewedFamilyEditor = this;
      CanvasEditor.prototype.relayout = original;
      return result;
    };
  });
}
export async function reviewedFamilyOrigins(page, source, allowStandardLigatures = false, currentEditor = false) {
  return page.evaluate(async ({ encoded, allowStandardLigatures, currentEditor }) => {
    const { openCanvasDocument, CanvasEditor, setCanvasTextStyle, setCanvasFontAlternatives, fontAvailable }
      = await import('/tools/reviewed-family-modules.js');
    let pkg, images, host, editor;
    if (currentEditor) {
      editor = window.reviewedFamilyEditor;
      if (!editor || editor.destroyed || editor.input !== document.querySelector('.canvas-input')) throw new Error('Expected the current visible editor.');
      pkg = { styles: editor.model.styles, readOnly: editor.readOnly };
    } else {
      ({ pkg, images } = await openCanvasDocument(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
      host = document.createElement('div'); document.body.append(host);
    }
    try {
    if (pkg.readOnly) throw new Error('The native glyph oracle requires the editable structured document, not an approximation.');
    if (!currentEditor) editor = new CanvasEditor(host, { ...pkg, images });
    const ctx = document.createElement('canvas').getContext('2d');
    setCanvasFontAlternatives(ctx, pkg.styles?.fontAlternatives);
    const layout = editor.layout;
    return {
      available: ['Oswald', 'Open Sans'].map(fontAvailable),
      pages: layout.pages.map((_, index) => layout.lines.filter(line => line.page === index).map(line => {
        const glyphs = [], advanceErrors = [];
        for (const fragment of line.fragments) {
          if (!(fragment.ligatures === 'none' || allowStandardLigatures && fragment.ligatures === 'standard') ||
              fragment.bidiLevel % 2 || fragment.textTransform || ['caps', 'smallCaps'].includes(fragment.capitalization) ||
              /[^\x20-\x7e]/.test(fragment.text)) throw new Error('This glyph oracle requires untransformed left-to-right ASCII controls.');
          const scale = 1536 / fragment.fontSize;
          setCanvasTextStyle(ctx, { ...fragment, fontSize: 1536, kerning: fragment.kerning ? fragment.kerning * scale : 0,
            characterSpacing: (fragment.characterSpacing || 0) * scale, justificationSpacing: (fragment.justificationSpacing || 0) * scale });
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const text = document.createElementNS(svg.namespaceURI, 'text');
          Object.assign(svg.style, { position: 'fixed', visibility: 'hidden', width: '1px', height: '1px', overflow: 'visible' });
          Object.assign(text.style, { font: ctx.font, letterSpacing: ctx.letterSpacing, wordSpacing: ctx.wordSpacing, fontKerning: ctx.fontKerning, textRendering: ctx.textRendering, whiteSpace: 'pre', fontVariantLigatures: fragment.ligatures === 'standard' ? 'common-ligatures' : 'none' });
          text.textContent = fragment.text; svg.append(text); document.body.append(svg);
          try {
            advanceErrors.push(Math.abs(text.getComputedTextLength() / scale - fragment.width));
            for (let i = 0; i < text.getNumberOfChars(); i++) glyphs.push((fragment.x + text.getStartPositionOfChar(i).x / scale) * .75);
          } finally { svg.remove(); }
        }
        const text = line.fragments.map(f => f.text).join('').trimEnd();
        return { text, baseline: line.baseline * .75, glyphs: glyphs.slice(0, text.length), advanceErrors };
      })),
    };
    } finally {
      if (!currentEditor) {
        if (editor) editor.destroy();
        else { for (const image of images.values()) image.close?.(); images.clear(); }
        host.remove();
      }
    }
  }, { encoded: source, allowStandardLigatures, currentEditor });
}
