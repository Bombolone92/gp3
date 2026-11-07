import { localFamilyMetadata, localFamilyFontData, localFontVersion } from './local-fonts.js';
import { withoutLegacyKerning } from './legacy-kerning-font.js';
import { syntheticAdvanceFont } from './synthetic-advance-font.js';
import { usesSyntheticAdvance } from './synthetic-bold.js';

const policies = new Map();
let serial = 0;
const key = name => name.trim().toLowerCase();
export const requestsOpenTypeKerning = style => Boolean(style?.ligatures && style.ligatures !== 'none' && style.kerning > 0 && !style.characterSpacing);
export const legacyOnlyFamily = faces => faces.length > 0 && faces.every(face => face && !face.variable && face.legacyKerning && !face.glyphPositioning);
export function selectKerningSources(sources, name) {
  const base = sources.find(s => key(s.fullName || '') === key(name)) || sources.find(s => s.metadata.weight === 400 && !s.metadata.italic && s.metadata.widthClass === 5) || sources[0];
  const width = base?.metadata.widthClass || 5, chosen = new Map();
  for (const source of sources) {
    const id = `${source.metadata.weight}/${source.metadata.italic}`, previous = chosen.get(id);
    if (!previous || Math.abs(source.metadata.widthClass - width) < Math.abs(previous.metadata.widthClass - width)) chosen.set(id, source);
  }
  return [...chosen.values()];
}

// The enabled OpenType/ligature path omits legacy-only kern pairs. Require
// every selectable family face to agree, so changing bold/italic cannot apply
// metadata from a different face. Unknown, mixed and variable families retain
// existing behavior. Preparation is limited to runs requesting this behavior.
export async function prepareOpenTypeKerning(name) {
  const normalized = key(name), previous = policies.get(normalized);
  if (previous?.version === localFontVersion()) return previous.promise;
  if (previous) { await previous.promise; if (policies.get(normalized) !== previous) return prepareOpenTypeKerning(name); }
  const entry = { version: localFontVersion(), faces: [] };
  entry.promise = (async () => {
    try {
      const metadata = await localFamilyMetadata(name);
      if (!legacyOnlyFamily(metadata)) return;
      const available = await localFamilyFontData(name);
      if (!legacyOnlyFamily(available.map(s => s.metadata))) return;
      // Local Font Access groups condensed and ordinary subfamilies together.
      // Preserve the requested face's width when registering CSS weights/styles.
      const sources = selectKerningSources(available, name);
      const alias = `Canvas OpenType kerning ${++serial}`, syntheticAlias = `${alias} synthetic`;
      for (const source of sources) {
        const data = withoutLegacyKerning(source.buffer);
        if (!data) throw new Error('Unsupported legacy kerning face');
        entry.faces.push(await new FontFace(alias, data, { weight: String(source.metadata.weight), style: source.metadata.italic ? 'italic' : 'normal' }).load());
      }
      // Preserve the separate synthetic glyph-advance correction when a true
      // bold face is absent. Paint selects this same single-weight family.
      for (const italic of [false, true]) if (usesSyntheticAdvance({ bold: true, italic }, name)) {
        const styled = sources.filter(s => s.metadata.italic === italic);
        const candidates = styled.length ? styled : sources.filter(s => !s.metadata.italic);
        const order = weight => weight >= 400 && weight <= 500 ? weight - 400 : weight < 400 ? 500 - weight : weight + 100;
        const source = [...candidates].sort((a, b) => order(a.metadata.weight) - order(b.metadata.weight))[0];
        const adjusted = source && syntheticAdvanceFont(source.buffer), data = adjusted && withoutLegacyKerning(adjusted);
        if (!data) throw new Error('Unsupported synthetic legacy kerning face');
        entry.faces.push(await new FontFace(syntheticAlias, data, { weight: '700', style: italic ? 'italic' : 'normal' }).load());
      }
      entry.faces.forEach(face => document.fonts.add(face));
      entry.alias = alias; entry.syntheticAlias = syntheticAlias;
    } catch { entry.faces.forEach(face => document.fonts.delete(face)); entry.faces = []; }
    finally {
      entry.version = localFontVersion();
      previous?.faces.forEach(face => document.fonts.delete(face));
    }
  })();
  policies.set(normalized, entry);
  await entry.promise;
}
export function openTypeKerningFamily(style, synthetic = false) {
  const entry = policies.get(key(style.fontFamily || style.fontAscii || 'Noto Sans'));
  if (!requestsOpenTypeKerning(style) || entry?.version !== localFontVersion()) return undefined;
  return synthetic ? entry.syntheticAlias : entry.alias;
}
