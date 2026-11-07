# Numbering override index and counter controls

Original OOXML authored with Python's standard library by
`tools/numbering_override_index_fixture.py`. No application serializer or native
reference edits construct the sources. The generator's OPC contents were compared
byte-for-byte with all three captured source packages after native inspection.

`control.docx` contains 16 conflicting parent/child level indexes. `matched.docx`
changes only the child indexes to match the parent. `matched-identified.docx`
also supplies unique abstract nsid values and explicit multilevel declarations.
Each source has four outer/inner index combinations, with/without startOverride=7,
and labels referencing either level; abstract starts are 1 and child starts 3.
`cases.json` describes the rows. `control-identified.docx` is also generated but
has no captured oracle and is not needed for the current checked-in evidence.

The reference application rendered three PDFs, one page each. The PDF-derived 48 marker
observations and exact source/PDF/PNG hashes are in `reference.json`.
`tools/record_numbering_override_index.py --reference-build 16.0.20326` reproduces the
reference and images from the PDFs. Fonts in these PDFs are native reference
output, not application font assets. No runtime resources or dependencies changed.

Native results:

- All 16 conflicting-index rows have empty markers. Native WordOpenXML inspection
  showed an empty replacement level at the parent index, retaining an explicit
  startOverride when present. Direct automation checks of rows 1/3/5/7 gave counter
  values 1/7/1/7 and zero left/first-line indents. Counter/geometry checks cover
  those four rows, not every possible combination.
- With matching indexes, rows using their own level have C1 without startOverride
  and C3 with startOverride=7. The baseline viewer emitted C3 and C7. Explicit nsid
  and multilevel declarations reproduce the same native results.
- Deeper references in full overrides use abstract B1 labels in the reference application; the baseline viewer
  suppressed those labels. Ancestor-reference rows remain D1 in the reference application.

Relevant supplied ECMA-376 Part 1 clauses: 17.9.8 (PDF 715–717), 17.9.11,
17.9.25–26 (PDF 737–739). Section 17.9.8 says a conflicting child ilvl is ignored;
the native empty-level normalization means simply rebinding the child properties
to the parent index is insufficient. Counter results diverge from directly using
the child start or explicit startOverride as the initial value described by
17.9.25–26. These are independently reproduced observations, not corpus-specific
rules. Full-level overrides and abstract definitions must be distinguished when
implementing starts and deeper-reference handling.

Implementation follow-up: the shared importer now handles these three cases.
The sibling `numbering-override-sequences` controls add 132 native rows covering
initial counts versus ancestor resets, hidden counters and restart serialization.
The former expected failures are now normal required assertions. Editing and
export preserve source declarations except for explicitly requested mutations.

The unit file has four required reference checks and three required behavior
checks. All 12 XML parts across three sources pass the local transitional XSD
checker. Full numbering-family agreement and untested combinations remain open.
A corpus scan found zero conflicting parent/child indexes in 368 documents; no
original template is promoted by this investigation.

Capture notes: the required reference-application opening helper was used before automation.
Successful PDFs came from binding the already-open exact path and calling
ExportAsFixedFormat(17). Two redundant bulk capture attempts stalled and were
explicitly stopped; their completion is not claimed. An old Zoom dialog and a
read-only information notice were dismissed without editing source content.
The incomplete capture script and live scratch dumps are not published as tools.
