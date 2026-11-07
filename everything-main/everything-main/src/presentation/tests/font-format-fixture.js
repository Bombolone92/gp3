// Synthetic metadata containers, not fonts for rendering/native visual checks.
// Independent writers let parser tests vary ordering, encodings and versions.
export function fontNames(records, languageTags = []) {
  const encode = (text, platform = 3) => {
    if (platform === 1) return Uint8Array.from(text, (c) => c.charCodeAt(0));
    const bytes = new Uint8Array(text.length * 2),
      v = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++)
      v.setUint16(i * 2, text.charCodeAt(i));
    return bytes;
  };
  const data = records.map((r) => r.bytes ?? encode(r.value, r.platform));
  const tags = languageTags.map((text) => encode(text));
  const format = languageTags.length ? 1 : 0;
  const start = 6 + records.length * 12 + (format ? 2 + tags.length * 4 : 0);
  const bytes = new Uint8Array(
      start + [...data, ...tags].reduce((n, b) => n + b.length, 0),
    ),
    v = new DataView(bytes.buffer);
  v.setUint16(0, format);
  v.setUint16(2, records.length);
  v.setUint16(4, start);
  let offset = 0;
  records.forEach((r, i) => {
    const at = 6 + i * 12;
    [
      r.platform ?? 3,
      r.encoding ?? 1,
      r.language ?? 0x409,
      r.id,
      data[i].length,
      offset,
    ].forEach((value, index) => v.setUint16(at + index * 2, value));
    bytes.set(data[i], start + offset);
    offset += data[i].length;
  });
  if (format) {
    const at = 6 + records.length * 12;
    v.setUint16(at, tags.length);
    tags.forEach((tag, i) => {
      v.setUint16(at + 2 + i * 4, tag.length);
      v.setUint16(at + 4 + i * 4, offset);
      bytes.set(tag, start + offset);
      offset += tag.length;
    });
  }
  return bytes;
}

export function fontTables(entries, signature = 0x00010000) {
  let size = 12 + entries.length * 16;
  const records = entries.map(([tag, bytes]) => {
    size = Math.ceil(size / 4) * 4;
    const at = size;
    size += bytes.length;
    return { tag, bytes, at };
  });
  const bytes = new Uint8Array(size),
    v = new DataView(bytes.buffer);
  v.setUint32(0, signature);
  v.setUint16(4, entries.length);
  records.forEach((record, i) => {
    const at = 12 + i * 16;
    bytes.set(
      Uint8Array.from(record.tag, (c) => c.charCodeAt(0)),
      at,
    );
    v.setUint32(at + 8, record.at);
    v.setUint32(at + 12, record.bytes.length);
    bytes.set(record.bytes, record.at);
  });
  return bytes;
}

export function metadataFont(options = {}) {
  const {
    family = "Independent Book",
    subfamily = "Regular",
    weight = 400,
    selection = 64,
    fsType = 8,
    os2Version = 4,
    shortened = false,
    extraTables = [],
    names,
  } = options;
  const head = new Uint8Array(54),
    h = new DataView(head.buffer);
  h.setUint32(8, 0xa3b1c209);
  h.setUint32(12, 0x5f0f3cf5);
  h.setUint16(44, options.macStyle ?? 0);
  const os2 = new Uint8Array(
      shortened
        ? 68
        : os2Version === 0
          ? 78
          : os2Version === 1
            ? 86
            : os2Version < 5
              ? 96
              : 100,
    ),
    o = new DataView(os2.buffer);
  o.setUint16(0, os2Version);
  o.setUint16(4, weight);
  o.setUint16(8, fsType);
  o.setUint16(62, selection);
  os2.set([2, 4, 5, 3, 5, 4, 6, 2, 3, 4], 32);
  [42, 46, 50, 54].forEach((at, i) => o.setUint32(at, 2 ** (i + 4)));
  if (os2Version >= 1) {
    o.setUint32(78, 0x80000001);
    o.setUint32(82, 0x1020);
  }
  const entries = [
    [
      "name",
      names ??
        fontNames([
          { id: 1, value: family },
          { id: 2, value: subfamily },
          { id: 4, value: `${family} ${subfamily}` },
          { id: 5, value: "Version 2.34" },
          { id: 6, value: family.replaceAll(" ", "") },
          { id: 16, value: "Independent" },
          { id: 17, value: "Book" },
        ]),
    ],
    ["head", head],
    ...(options.noOs2 ? [] : [["OS/2", os2]]),
    [options.cff ? "CFF " : "glyf", new Uint8Array([0, 0, 0, 0])],
    ...extraTables,
  ];
  return fontTables(entries, options.cff ? 0x4f54544f : 0x00010000);
}

export function eotFixture(options = {}) {
  const {
    version = 0x20002,
    flags = 0,
    payload = new Uint8Array([23, 42, 89]),
    root = "https://example.test/\0",
    signature = new Uint8Array([71, 72]),
    eudc = new Uint8Array([15, 29]),
    eudcFlags = 0x10000000,
  } = options;
  const strings = [
    "Different Family",
    "Italic",
    "Version 9.876",
    "Different Family Italic",
  ];
  const utf = (text) => {
    const b = new Uint8Array(text.length * 2),
      v = new DataView(b.buffer);
    for (let i = 0; i < text.length; i++)
      v.setUint16(i * 2, text.charCodeAt(i), true);
    return b;
  };
  const blocks = strings.map(utf),
    rootBytes = utf(root);
  const base = 80 + blocks.reduce((n, b) => n + 4 + b.length, 0);
  const extra =
    version === 0x10000
      ? 0
      : 4 +
        rootBytes.length +
        (version === 0x20002 ? 20 + signature.length + eudc.length : 0);
  const bytes = new Uint8Array(base + extra + payload.length),
    v = new DataView(bytes.buffer);
  v.setUint32(0, bytes.length, true);
  v.setUint32(4, payload.length, true);
  v.setUint32(8, version, true);
  v.setUint32(12, flags, true);
  bytes[26] = 0;
  bytes[27] = 1;
  v.setUint32(28, 650, true);
  v.setUint16(32, options.fsType ?? 8, true);
  v.setUint16(34, 0x504c, true);
  let at = 80;
  const string = (data) => {
    v.setUint16(at + 2, data.length, true);
    bytes.set(data, at + 4);
    at += 4 + data.length;
  };
  blocks.forEach(string);
  if (version !== 0x10000) {
    string(rootBytes);
    if (version === 0x20002) {
      const sum = rootBytes.reduce((n, b) => n + b, 0);
      v.setUint32(at, (sum ^ 0x50475342) >>> 0, true);
      v.setUint32(at + 4, 932, true);
      v.setUint16(at + 10, signature.length, true);
      bytes.set(signature, at + 12);
      at += 12 + signature.length;
      v.setUint32(at, eudcFlags, true);
      v.setUint32(at + 4, eudc.length, true);
      bytes.set(eudc, at + 8);
      at += 8 + eudc.length;
    }
  }
  bytes.set(payload, at);
  return bytes;
}
