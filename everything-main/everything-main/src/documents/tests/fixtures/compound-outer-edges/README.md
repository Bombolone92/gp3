# Compound table outer-edge placement

`tools/compound_outer_edges_fixture.py` independently authors 32 tables in each
of compatibility modes 12 and 15. The controls use both small/medium thin/thick
orders, sizes 0/11/24/36, automatic and exact 48pt rows, and 3pt cell margins.
Each side has its own color. No preceding paragraph border affects the table's
origin, and each page contains only one table. No corpus markup, artwork or
font file is copied.

The reference application exported both `native.pdf` files read-only using
`tools/export-reference.ps1`. `tools/record_compound_outer_edges.py` binds
source/PDF hashes and records native colored rectangles and text origins. It
checks rectangle vertices before treating PDF path bounds as filled rectangles.

The reference application aligns the top and bottom ink to the corresponding reserved outer edge.
The bottom paint inset is ink width minus reserved half-width; using the same
half-width inset as the top shortens the frame when compound bands quantize to
less than their allocated space. Explicit zero allocation must remain zero,
even when a minimum ink band is painted. Layout allocation and text geometry
are unchanged by this placement correction.

The browser checks all four absolute frame edges within .09pt, retains the
existing .15pt edge exclusion for corner-color samples, and verifies editable
opening, no-edit equality, insertion, unrelated parts, exact undo and reopening.
All 64 native/app table regions were visually inspected. PDF/browser thin-line
coverage differs; these tests do not claim identical device-pixel rasterization.
Text origins are recorded for further checks, not asserted by this browser test.

ECMA-376 Part 1 §§17.4.38, 17.4.66, 17.4.80 and 17.18.2 define table borders,
cell borders, row height and border styles. This numerical placement is native
measured reference behavior beyond the declarations; no new normative
contradiction is asserted. Existing mixed-color corners, opposed row borders,
shared crossings and page-fragment controls provide regression coverage.
