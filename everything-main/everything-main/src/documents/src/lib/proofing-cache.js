// Pure scope/range operations shared by import and the lazy editor view.
// This module must not import the document engine into the app shell.
export function proofingFingerprint(paragraphs) {
  const groups = [];
  for (const p of paragraphs) {
    for (const run of p.runs) {
      // A picture's object character is not checked text, so adding or removing one is not a scope change.
      if (!run.text.length || run.image) continue;
      const scope = JSON.stringify([!!run.noProof, run.fontLanguage || '', run.fontEastAsiaLanguage || '', run.fontBidiLanguage || '']);
      const previous = groups.at(-1);
      if (previous?.[0] === scope) previous[1] += run.text.length;
      else groups.push([scope, run.text.length]);
    }
    groups.push(['paragraph', 1]);
  }
  return JSON.stringify(groups);
}

// Proofing checks whole words intersecting saved ranges, including partial anchors.
// Both lists are ordered; this remains linear even for documents with many errors.
export function wordsInSavedRanges(words, ranges) {
  const result = []; let at = 0;
  for (const word of words) {
    while (at < ranges.length && ranges[at].end <= word.start) at++;
    if (at === ranges.length) break;
    if (ranges[at].start < word.end) result.push(word);
  }
  return result;
}
