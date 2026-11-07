// Localized family names from a font's `name` table, for showing local fonts
// in the user's language (Preferences → Type → Show font names in English off).

// Windows primary language IDs (low 10 bits of an LCID) by BCP 47 language.
const PRIMARY: Record<string, number> = {
  ar: 0x01, bg: 0x02, ca: 0x03, zh: 0x04, cs: 0x05, da: 0x06, de: 0x07, el: 0x08, en: 0x09, es: 0x0a, fi: 0x0b, fr: 0x0c, he: 0x0d, hu: 0x0e,
  is: 0x0f, it: 0x10, ja: 0x11, ko: 0x12, nl: 0x13, nb: 0x14, no: 0x14, pl: 0x15, pt: 0x16, ro: 0x18, ru: 0x19, hr: 0x1a, sk: 0x1b, sv: 0x1d,
  th: 0x1e, tr: 0x1f, id: 0x21, uk: 0x22, sl: 0x24, et: 0x25, lv: 0x26, lt: 0x27, fa: 0x29, vi: 0x2a, hi: 0x39, ms: 0x3e, bn: 0x45,
};
// Chinese: simplified (PRC, Singapore) and traditional (Taiwan, Hong Kong, Macau) LCIDs.
const ZH_TRADITIONAL = new Set([0x0404, 0x0c04, 0x1404]);

/** The localized name (typographic family, else family) for `lang`, or undefined. */
export function localizedFamilyName(name: DataView, lang: string): string | undefined {
  const [primaryTag, region = ''] = lang.toLowerCase().split(/[-_]/);
  const primary = PRIMARY[primaryTag];
  if (!primary || primary === 0x09) return undefined;
  const traditional = primaryTag === 'zh' && /^(tw|hk|mo|hant)$/.test(region);
  const count = name.getUint16(2),
    strings = name.getUint16(4);
  for (const wanted of [16, 1]) {
    let best: string | undefined;
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      if (o + 12 > name.byteLength) break;
      const platform = name.getUint16(o),
        language = name.getUint16(o + 4),
        nameId = name.getUint16(o + 6),
        length = name.getUint16(o + 8),
        offset = name.getUint16(o + 10);
      if (platform !== 3 || nameId !== wanted || (language & 0x3ff) !== primary) continue;
      if (primaryTag === 'zh' && ZH_TRADITIONAL.has(language) !== traditional) continue;
      const start = strings + offset;
      if (start + length > name.byteLength) continue;
      let s = '';
      for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(name.getUint16(start + k));
      if (s.trim()) best = s.trim();
      if (best) return best;
    }
  }
  return undefined;
}

/** Read the `name` table of a font file (or the first font of a collection)
 * without loading the whole file. */
export async function readNameTable(blob: Blob): Promise<DataView | undefined> {
  const view = async (start: number, length: number) => new DataView(await blob.slice(start, start + length).arrayBuffer());
  let base = 0;
  const head = await view(0, 12);
  if (head.byteLength < 12) return undefined;
  if (head.getUint32(0) === 0x74746366) {
    // 'ttcf': offset of the first font's table directory.
    base = (await view(12, 4)).getUint32(0);
  }
  const dir = base ? await view(base, 12) : head;
  const tables = dir.getUint16(4);
  const records = await view(base + 12, tables * 16);
  for (let i = 0; i < tables; i++) {
    const o = i * 16;
    if (o + 16 > records.byteLength) break;
    if (records.getUint32(o) !== 0x6e616d65) continue; // 'name'
    const offset = records.getUint32(o + 8),
      length = records.getUint32(o + 12);
    if (length > 4 * 1024 * 1024) return undefined;
    return view(offset, length);
  }
  return undefined;
}
