// Missing glyph protection: split typed text into runs drawn by the chosen
// font and runs that need a fallback font which has the characters.

export type GlyphSource = { family: string; has(cp: number): boolean };

/** Runs of `text`; a run's family is undefined when the base font draws it
 * (or no fallback has the characters either). Whitespace and controls never
 * switch fonts. */
export function glyphRuns(text: string, base: GlyphSource | undefined, fallbacks: GlyphSource[]): [string, string | undefined][] {
  const runs: [string, string | undefined][] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let family: string | undefined;
    if (base && cp > 0x20 && !/\s/.test(ch) && !base.has(cp)) family = fallbacks.find((f) => f.family !== base.family && f.has(cp))?.family;
    const last = runs.at(-1);
    if (last && last[1] === family) last[0] += ch;
    else runs.push([ch, family]);
  }
  return runs;
}
