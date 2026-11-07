import { hasKoreanText, textFontFile } from './core/document.js';
import { fallbackVariant, originalGlyphs } from './core/text-edit.js';

/** Match the Korean replacement face when the source subset cannot spell the draft. */
export function koreanDraftFace(run, text, variant) {
  if (!hasKoreanText(text)) return null;
  if (run && !variant && text.split('\n').every((line) => originalGlyphs(run.map, line)))
    return null;
  const style = variant || (run ? fallbackVariant(run) : 'regular');
  return {
    family: "'Noto Sans KR'",
    weight: style.startsWith('bold') ? 'bold' : 'normal',
    style: 'normal',
    ligatures: 'normal',
  };
}

export function ensureKoreanFontFaces(text) {
  return hasKoreanText(text)
    ? Promise.all(['regular', 'bold'].map((variant) => ensureStyledFontFaces(variant, text)))
    : Promise.resolve([]);
}

const loading = new Map();
/**
 * Load only the selected face, under the same family for regular and styled drafts.
 * Failed requests can be retried without registering duplicate faces.
 */
export function ensureStyledFontFaces(variant = 'regular', text = '') {
  let file;
  try {
    file = textFontFile(variant, text);
  } catch {
    return Promise.resolve(false);
  }
  if (loading.has(file)) return loading.get(file);
  if (typeof FontFace !== 'function' || !document.fonts) return Promise.resolve(false);
  const pending = new FontFace(
    hasKoreanText(text) ? 'Noto Sans KR' : 'Noto Sans Styled',
    `url(${import.meta.env.BASE_URL}fonts/${file})`,
    {
      weight: variant.startsWith('bold') ? '700' : '400',
      style: variant.toLowerCase().includes('italic') ? 'italic' : 'normal',
    },
  )
    .load()
    .then((face) => {
      document.fonts.add(face);
      return true;
    })
    .catch(() => {
      loading.delete(file);
      return false;
    });
  loading.set(file, pending);
  return pending;
}
