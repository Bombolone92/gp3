Independent XML generator: `tools/canvas_row_border_insets_fixture.py`.
Sources: `public/fixtures/row-border-insets.docx` (6 pages) and
`public/fixtures/row-border-opposition.docx` (12 pages). Regenerated XML parts
were compared byte-for-byte with the captured sources.

Each page has an Arial 12pt lead, a three-row table and a following paragraph.
The header row has a 36pt minimum, bottom-aligned text, and 6pt vertical margins.
The first source varies bottom borders (absent, 1pt, 2pt) and whether the header
omits its final grid column. The second varies opposing top borders (absent,
0.5pt, 1pt, 2pt, 3pt, nil) against 1pt/2pt preceding bottom borders.

The reference application opened each exact source and exported the retained PDF and
FlatOPC without saving the source. `manifest.json` records SHA256 hashes;
`positions.json` records text origins in points from the upper-left page corner.
The following row's text position depends on its own declared top-border width,
not the winning painted edge. Absent and nil top borders add no width even
when the preceding bottom border remains visible. Grid omission does not
change these vertical positions. This is a native layout compatibility detail;
these probes do not establish a contradiction with a prescribed OOXML inset.

Browser regressions compare all 90 text positions within 0.2pt, edit, download,
undo and reopen, preserving non-document parts and exact undo. The comparison
requires installed Arial (not redistributed); it skips when Arial is missing.
Existing generic row and border tests do not require that reference font.
