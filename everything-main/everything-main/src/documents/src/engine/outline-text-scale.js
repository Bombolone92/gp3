import { kerningEnabled } from './kerning.js';
import { isBundledFont } from './font-availability.js';

// Use font outlines rather than small embedded bitmap strikes. Resolve the
// kerning threshold at the authored size before changing the measurement em.
export function outlineTextScale(style) {
  // The bundled outline-only Noto files have no bitmap strikes. Preserve their
  // existing paint path; native fonts may carry size-specific bitmap advances.
  const factor = isBundledFont(style.fontFamily || style.fontAscii || 'Noto Sans') ? 1 : Math.max(1, 1536 / (style.fontSize ?? 12));
  if(factor===1)return {factor,style};
  const scaled = {
    ...style, fontSize: (style.fontSize ?? 12) * factor,
    characterSpacing: (style.characterSpacing || 0) * factor,
    justificationSpacing: (style.justificationSpacing || 0) * factor,
    kerning: kerningEnabled(style) ? 1 : 0,
    ...(style.textOutline ? { textOutline: { ...style.textOutline, width: style.textOutline.width * factor } } : {}),
  };
  if(style.verticalAlign&&style.verticalAlign!=='baseline')scaled.scriptReferenceSize=style.scriptReferenceSize??style.fontSize??12;
  return {factor,style:scaled};
}

export function fractionalTextScale(style) {
  const em = (style.fontSize ?? 12) * 4 / 3, aligned = Math.ceil((em - 1e-8) * 100) / 100;
  const factor = aligned / em;
  if (Math.abs(factor - 1) < 1e-10) return { factor: 1, style };
  const scaled = {
    ...style, fontSize: (aligned + Math.max(1e-6, aligned * 1e-7)) * .75,
    characterSpacing: (style.characterSpacing || 0) * factor,
    justificationSpacing: (style.justificationSpacing || 0) * factor,
    kerning: kerningEnabled(style) ? 1 : 0,
    ...(style.textOutline ? { textOutline: { ...style.textOutline, width: style.textOutline.width * factor } } : {}),
  };
  if(style.verticalAlign&&style.verticalAlign!=='baseline')scaled.scriptReferenceSize=style.scriptReferenceSize??style.fontSize??12;
  return {factor,style:scaled};
}
