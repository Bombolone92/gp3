import { missingMetafileFonts } from './metafile-fonts.js';
import { metafileFileFonts } from './metafile-file-fonts.js';
import { checkFontAvailability, canvasFontSources } from './font-availability.js';

const downloads = new Map();
async function reviewedFaces(name) {
  await checkFontAvailability(name);
  const sources = canvasFontSources(name);
  if (!sources.length) return null;
  const urls = sources.map(face => {
    const match = /^url\(("(?:\\.|[^"\\])*")\)$/.exec(face.source);
    if (!match) return null;
    const url = new URL(JSON.parse(match[1]), document.baseURI);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === new URL(document.baseURI).origin ? url.href : null;
  });
  if (urls.some(url => !url)) return null;
  return Promise.all(sources.map(async (face, i) => {
    const url = urls[i];
    if (!downloads.has(url)) {
      const job = (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Picture font could not load.');
        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength || buffer.byteLength > 32 * 1024 * 1024) throw new Error('Picture font size is unsupported.');
        return buffer;
      })();
      downloads.set(url, job);
      job.catch(() => { if (downloads.get(url) === job) downloads.delete(url); });
    }
    return { buffer: await downloads.get(url), descriptors: face.descriptors || {} };
  }));
}

// Generated EMF images are isolated SVG documents: page FontFaces do not carry
// into them. Bridge only requested, reviewed same-origin fonts when neither an
// installed GDI family alternative nor an explicitly supplied file is usable.
export async function prepareMetafileFonts(svg, groups) {
  if (!groups.length) return { svg, missing: [] };
  const missing = new Set(await missingMetafileFonts(groups)), additional = new Map();
  await Promise.all(groups.filter(group => missing.has(group[0])).map(async group => {
    for (const name of group) {
      try {
        const faces = await reviewedFaces(name);
        if (!faces) continue;
        additional.set(name, { alias: `Canvas metafile font ${name}`, faces });
        missing.delete(group[0]);
        break;
      } catch { /* Retain the native/fallback SVG and its missing-font notice. */ }
    }
  }));
  return { svg: metafileFileFonts(svg, groups, additional), missing: [...missing] };
}
