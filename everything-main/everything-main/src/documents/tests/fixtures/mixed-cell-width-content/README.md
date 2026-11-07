# Mixed widths, content and noWrap scope

**2026-09-29 correction:** The coupled eight-twip edge allowance and constrained
rounding rule now pass these native controls. The prior expected failures have
been removed without relaxing the 0.2pt geometry gate. Notes below describing
pending fixes or failed candidates are historical evidence against the parent
implementation (db793e48); they are superseded by this result. Automatic cells
with unresolved grid subdivisions remain outside the new rounding rule.


Original OOXML assembled by `tools/mixed_cell_width_content_fixture.py` with
Python standard-library XML/ZIP construction and fixed ZIP metadata. No corpus
text, XML, fonts or third-party engine implementation is included.

Sixteen cases cross body-only/all-cell noWrap, short letters/currency text,
Arial 9/12pt, and 0/48-twip cell margins. Each table has four columns, two
explicit body preferences (2400/1440 twips), two automatic columns, automatic
merged headers, and a 6000-twip explicit merged footer. The saved grid is
3000/1800/600/600 twips. The second group changes only the noWrap scope.

The reference application opened the exact source read-only and exported
`native.pdf` (16 pages). The shared recorder extracts colored cell-fill bounds
independently of the app and hashes the DOCX, cases and native PDF. Unit tests
verify those hashes. Source and browser-export XML are checked against XSD.

The correction separates protected absolute preferences from measured content
maxima, preserves intrinsic minima during mixed-column growth, and accounts for
zero/nonzero margin edges. Fifteen cases now pass the unchanged 0.2pt cell
x/width tolerance. Case 2 retains one 0.21001pt third-column x mismatch; only
that case remains an explicit expected failure. Geometry regressions in other
cases, import/font/pagination/errors, package preservation, editing, exact undo
and reopening are asserted before that marker, so unrelated failures stay real.
Every actual/native coordinate is written to geometry.json.

The original 79 failing coordinates in fourteen cases are reduced to one.
The largest text-origin error fell from 41.82pt to 0.21001pt. These controls
do not establish every border/noWrap interaction. Corpus #64 remains partial.

ECMA-376 Part 1: 17.4.29 (noWrap), 17.4.49 (tblGrid), 17.4.63 (tblW),
17.4.71 (tcW), 17.18.87 (layout algorithm guidance). The guidance permits
algorithm flexibility; no normative reference/spec contradiction is established.

## Live reference allocation follow-up (2026-09-29)

A fresh reference export reproduces every stored PDF cell-fill bound exactly. Live
`Cell(3, column).Width` measurements, retained in `native-cell-widths.json`,
separate grid allocation from PDF paint quantization. The source remains saved
and unchanged. Case 2 allocates 3205/1923/436/436 twips; case 10, differing only
in noWrap scope, allocates 3204/1923/437/437. Their totals are respectively 6000
and 6001 twips. Do not force the latter measurement to the preferred table width.

Current case 2 allocates 3203/1923/437/437 after generic rounding. Captured
unrounded widths are 3204.272363150868/1922.5634178905211/436.5821094793055/
436.5821094793055 twips. The existing round-each-column/remainder rule cannot
reproduce both native noWrap scopes. This narrows the next repair to constrained
allocation and rounding; it does not justify changing all table rounding or
rounding all automatic columns down. The browser's explicit expected failure
and its original 0.2pt tolerance remain unchanged. No renderer fix is claimed.
