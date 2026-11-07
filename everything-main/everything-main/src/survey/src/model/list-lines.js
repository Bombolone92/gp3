/**
 * Splitting pasted text into list items (choices, rows), shared by the
 * builder's list editors. Kept apart from text-import.js, which loads only
 * when importing.
 */
const LIST_MARK_RE = /^\s*(?:[-*•]|\(?([a-z]|\d{1,3})[.)])\s+/i;

/** Position of a sequence marker: a or A is 1, b is 2, 3 is 3. */
const markValue = (m) => (/\d/.test(m) ? Number(m) : m.toLowerCase().charCodeAt(0) - 96);

/**
 * Lines pasted into a list of choices or rows, one item per line. List
 * markers ("-", "a)", "1.") are removed when the lines that have one
 * count up in order (a, b / 1, 2), as in "a. Yes, b. No, Other", or when
 * every line has a bullet or number. Initials and words ("A. Lincoln",
 * "Mr. Smith", "St. Louis") stay whole.
 */
export function splitPastedLines(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const marks = lines.map((l) => LIST_MARK_RE.exec(l));
  const found = marks.filter(Boolean);
  const counted = found.filter((m) => m[1]);
  const inOrder =
    found.length >= 2 && counted.length === found.length && counted.every((m, i) => i === 0 || markValue(m[1]) === markValue(counted[i - 1][1]) + 1);
  // Every line marked with bullets or numbers (Markdown numbers "1." each
  // time) is a list too; letters out of order are more likely initials.
  const allMarked = found.length === lines.length && found.every((m) => !m[1] || /\d/.test(m[1]));
  if (!allMarked && !inOrder) return lines;
  return lines.map((l, i) => (marks[i] ? l.slice(marks[i][0].length).trim() : l)).filter(Boolean);
}
