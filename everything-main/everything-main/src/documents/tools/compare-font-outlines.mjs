// Read-only font compatibility diagnostic. No font bytes or outlines are emitted.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as opentype from '../src/vendor/opentype/opentype.mjs';

const [referencePath, candidatePath] = process.argv.slice(2);
if (!referencePath || !candidatePath) {
  console.error('Usage: node tools/compare-font-outlines.mjs reference.ttf candidate.ttf');
  process.exit(1);
}

function load(path) {
  const bytes = readFileSync(path);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return {
    font,
    metadata: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      revision: font.tables.head.fontRevision,
      unitsPerEm: font.unitsPerEm,
      glyphSlots: font.numGlyphs,
    },
  };
}

const reference = load(referencePath);
const candidate = load(candidatePath);
function normalizedPath(glyph, font) {
  return JSON.stringify(glyph.path.commands.map(command => Object.fromEntries(
    Object.entries(command).map(([key, value]) => [key,
      typeof value === 'number' ? value / font.unitsPerEm : value]),
  )));
}
function equal(a, b) {
  return normalizedPath(a, reference.font) === normalizedPath(b, candidate.font)
    && a.advanceWidth / reference.font.unitsPerEm === b.advanceWidth / candidate.font.unitsPerEm;
}

const unicode = { compared: 0, exact: 0, different: 0, missing: 0, examples: [] };
const candidateMap = candidate.font.tables.cmap?.glyphIndexMap || {};
for (const [codepoint, gid] of Object.entries(reference.font.tables.cmap?.glyphIndexMap || {})) {
  unicode.compared++;
  const target = candidateMap[codepoint];
  if (target === undefined) { unicode.missing++; continue; }
  const a = reference.font.glyphs.get(gid);
  const b = candidate.font.glyphs.get(target);
  const same = equal(a, b);
  unicode[same ? 'exact' : 'different']++;
  if (!same && unicode.examples.length < 8) unicode.examples.push({
    codepoint: Number(codepoint), referenceGid: gid, candidateGid: target,
    referenceAdvance: a.advanceWidth, candidateAdvance: b.advanceWidth,
    referenceCommands: a.path.commands.length, candidateCommands: b.path.commands.length,
  });
}

// Includes ligatures/alternates absent from cmap. GID identity is meaningful only
// for a release preserving the reference's glyph ordering (e.g. PDF subsets).
const sameGid = { nonempty: 0, exact: 0, different: 0, missing: 0 };
for (let gid = 0; gid < reference.font.numGlyphs; gid++) {
  const a = reference.font.glyphs.get(gid);
  if (!a.path.commands.length) continue;
  sameGid.nonempty++;
  if (gid >= candidate.font.numGlyphs) { sameGid.missing++; continue; }
  sameGid[equal(a, candidate.font.glyphs.get(gid)) ? 'exact' : 'different']++;
}
console.log(JSON.stringify({
  reference: reference.metadata, candidate: candidate.metadata, unicode, sameGid,
  limitations: 'Exact normalized expanded path-command sequence and advance only. Different command or glyph ordering can fail equality without proving a visual difference. Does not compare hinting, shaping tables, font selection, synthetic styles, rasterization, or empty-glyph advances outside cmap.',
}, null, 2));
