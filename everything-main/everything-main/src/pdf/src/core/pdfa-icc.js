/**
 * A compact sRGB ICC profile (ICC.1:2001-04, version 2.1, display class), generated rather than
 * shipped so that no third-party profile has to be licensed: the matrix/TRC model of IEC
 * 61966-2-1 with D50-adapted (Bradford) primaries and a 1024-entry sRGB tone curve. PDF/A-1
 * needs a version 2 profile for its output intent, which later parts also accept.
 */
let cached;

const ascii = (text) => Array.from(text, (c) => c.charCodeAt(0));
const s15Fixed16 = (value) => {
  const n = Math.round(value * 65536);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
};
const uint32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const uint16 = (n) => [(n >>> 8) & 255, n & 255];
const xyz = (x, y, z) => [
  ...ascii('XYZ '),
  0,
  0,
  0,
  0,
  ...s15Fixed16(x),
  ...s15Fixed16(y),
  ...s15Fixed16(z),
];

// The PCS illuminant as the ICC header stores it (0xF6D6, 0x10000, 0xD32D).
const D50 = [0.9642029, 1, 0.8249054];

export const SRGB_DESCRIPTION = 'sRGB IEC61966-2.1';

export function srgbProfile() {
  if (cached) return cached.slice();
  const description = [
    ...ascii('desc'),
    ...[0, 0, 0, 0],
    ...uint32(SRGB_DESCRIPTION.length + 1),
    ...ascii(SRGB_DESCRIPTION),
    0,
    ...uint32(0), // Unicode language code
    ...uint32(0), // Unicode count
    ...uint16(0), // ScriptCode code
    0, // ScriptCode count
    ...new Array(67).fill(0),
  ];
  const copyright = [...ascii('text'), 0, 0, 0, 0, ...ascii('No copyright, use freely'), 0];
  const curve = [...ascii('curv'), 0, 0, 0, 0, ...uint32(1024)];
  for (let i = 0; i < 1024; i++) {
    const v = i / 1023;
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    curve.push(...uint16(Math.round(linear * 65535)));
  }
  const tags = [
    ['desc', description],
    ['cprt', copyright],
    ['wtpt', xyz(D50[0], D50[1], D50[2])],
    ['rXYZ', xyz(0.436066, 0.222488, 0.013916)],
    ['gXYZ', xyz(0.385147, 0.716873, 0.097076)],
    ['bXYZ', xyz(0.143066, 0.060608, 0.714096)],
    ['rTRC', curve],
    ['gTRC', curve],
    ['bTRC', curve],
  ];
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const placed = new Map(),
    table = [...uint32(tags.length)],
    data = [];
  for (const [signature, bytes] of tags) {
    // The three tone curves share one copy of the data, as the ICC format permits.
    if (!placed.has(bytes)) {
      while (offset % 4) {
        data.push(0);
        offset++;
      }
      placed.set(bytes, offset);
      data.push(...bytes);
      offset += bytes.length;
    }
    table.push(...ascii(signature), ...uint32(placed.get(bytes)), ...uint32(bytes.length));
  }
  while (offset % 4) {
    data.push(0);
    offset++;
  }
  const header = new Array(128).fill(0);
  header.splice(0, 4, ...uint32(offset));
  header.splice(8, 4, 0x02, 0x10, 0, 0);
  header.splice(12, 12, ...ascii('mntrRGB XYZ '));
  header.splice(24, 12, ...uint16(2026), ...uint16(1), ...uint16(1), 0, 0, 0, 0, 0, 0);
  header.splice(36, 4, ...ascii('acsp'));
  header.splice(68, 12, ...s15Fixed16(D50[0]), ...s15Fixed16(D50[1]), ...s15Fixed16(D50[2]));
  cached = new Uint8Array([...header, ...table, ...data]);
  return cached.slice();
}
