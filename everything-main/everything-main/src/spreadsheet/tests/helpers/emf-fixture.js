// GDI record builders for the EMF fixtures.
export const record = (type, words = []) => {
  const bytes = new Uint8Array(8 + words.length * 4), view = new DataView(bytes.buffer);
  [type, bytes.length, ...words].forEach((n, j) => view.setUint32(j * 4, n, true));
  return bytes;
};
const shorts = points => points.map(([x, y]) => (x & 65535) | ((y & 65535) << 16));
export function vectorEmf(extra = []) {
  const header = record(1, [0, 0, 100, 60, 0, 0, 3000, 1800, 0x464d4520, 0x10000, 0, 0, 4, 0, 0, 0, 1000, 600, 300, 180]);
  const records = [header, record(17, [8]), record(9, [200, 120]), record(11, [100, 60]),
    record(10, [-20, -10]), record(12, [5, 3]), record(19, [1]),
    record(39, [1, 0, 0x332211, 0]), record(37, [1]), record(95, [2, 44, 0, 44, 0, 5, 0, 0, 0, 0, 0]), record(37, [2]),
    record(91, [0, 0, 100, 60, 2, 8, 4, 4, ...shorts([[-20, -10], [140, -10], [140, 90], [-20, 90], [0, 10], [20, 10], [20, 30], [0, 30]])]),
    record(37, [0x80000000]), record(59), record(27, [0, 0]),
    record(88, [0, 0, 100, 60, 3, ...shorts([[20, 0], [20, 40], [40, 40]])]), record(61), record(60), record(62, [0, 0, 100, 60]),
    ...extra, record(40, [1]), record(40, [2]), record(14, [0, 16, 20])];
  const result = new Uint8Array(records.reduce((sum, b) => sum + b.length, 0));
  let pos = 0; for (const bytes of records) { result.set(bytes, pos); pos += bytes.length; }
  const view = new DataView(result.buffer); view.setUint32(48, result.length, true); view.setUint32(52, records.length, true);
  return result;
}
