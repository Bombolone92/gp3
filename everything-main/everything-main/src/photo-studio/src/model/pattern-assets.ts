import { decodePsdMetadata } from "./psd-metadata";
import { indexPsdPatterns } from "./psd-patterns";
export type PatternSpan = { start: number; end: number; ambiguous?: boolean };
// Offsets are relative to the immutable metadata asset, including typed-array
// offsets. The result retains no views into its potentially large input.
export function indexPatternAssets(
  bytes: Uint8Array,
): Map<string, PatternSpan> {
  const result = new Map<string, PatternSpan>(),
    raw = new Map<string, Uint8Array>();
  let count = 0;
  for (const tag of decodePsdMetadata(bytes).tags) {
    if (!["Patt", "Pat2", "Pat3"].includes(tag.key)) continue;
    for (const pattern of indexPsdPatterns(tag.data)) {
      count += 1 + pattern.channels.length;
      if (count > 262144) throw new Error("PSD pattern index budget exceeded.");
      const previous = raw.get(pattern.id),
        record = pattern.raw;
      if (previous) {
        // A fill identifies its definition by ID alone. Without a documented
        // precedence rule, choosing one conflicting native record is unsafe.
        if (
          previous.length !== record.length ||
          !previous.every((v, i) => v === record[i])
        )
          result.get(pattern.id)!.ambiguous = true;
      } else {
        const start = record.byteOffset - bytes.byteOffset;
        result.set(pattern.id, { start, end: start + record.length });
        raw.set(pattern.id, record);
      }
    }
  }
  return result;
}
