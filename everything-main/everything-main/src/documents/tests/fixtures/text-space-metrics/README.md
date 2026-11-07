# Blank-character font metrics on text lines

`tools/text_space_metrics_fixture.py` independently creates four sources:

- `mode14` and `mode15`: 24 cases each, with leading/internal/trailing spaces,
  em spaces, tabs and NBSP, at 9pt and 24pt alongside Calibri 12pt text.
- `decorations`: seven cases covering plain spaces, underline, strike,
  highlight, tabs and dot/line tab leaders.
- `mixed-drawings`: 26 Trebuchet MS controls with text and optional 9pt spaces,
  plus pictures or independently authored line shapes of 0.1–4pt height.

The reference application exported all 81 pages read-only. The reference extractor pins
source/PDF hashes and records Before/After and content glyph baselines.
The reference application excludes the blank characters' fonts from line allocation when text is
present, regardless of their position or decoration. NBSP retains its font
metrics. Picture-only and wholly blank lines retain their separate existing
minimum-height rules; the earlier inline-picture-whitespace controls remain
regression references. Source advances, tab placement and caret offsets are
preserved, as are underline/strike/highlight and tab-leader geometry.

Browser tests compare every recorded baseline within 0.15pt. They replace a
space with NBSP, export and reopen it, preserve unrelated OPC parts, and check
exact undo. Unit controls distinguish NBSP from blank characters and test
blank-line behavior after deletion. The sources import and remain editable.

ECMA-376 Part 1 §17.3.1.33 (`spacing`) and §17.3.1.29 (paragraph-mark `rPr`)
provide line-spacing/mark semantics; §17.3.3.31 (`t`) and §17.3.3.32 (`tab`)
preserve the text and tab content. They do not explicitly define these blank
characters' participation in font-based vertical allocation. This fixture
records observed native behavior without claiming an explicit normative
contradiction or altering stored font sizes.

The email-signature gallery's remaining website baseline error falls from
0.992pt to within 0.15pt; all 165 baselines are now within 0.135pt. The separate
Franklin Gothic Book bold paint-weight difference remains under investigation.
