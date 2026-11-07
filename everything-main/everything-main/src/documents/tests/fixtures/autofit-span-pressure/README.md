# AutoFit span-pressure controls

These references cover measured cases, not complete layout certification.
Original OOXML is authored by `tools/autofit_span_pressure_fixture.py`;
no corpus content, font binary or third-party layout engine is included.
The reference application exported each package read-only using
`tools/export-reference.ps1`. Every generated OPC part was checked against
the exact scratch source used for that export. `tools/record_autofit_span_pressure.py`
extracts the widest native fill rectangle of each cell color and records hashes.

The table uses four saved grid columns (1800/1800/600/1800 twips), an automatic
table width, and 80-twip side margins. Its first row requests 3000 twips across
two columns, a 600-twip empty spacer and a 2400-twip text cell. Optional bottom
rows request 1600 twips in column one and 4400 across columns two through four.
Pressure is an unbreakable 20-letter word in the first merged cell.

`legacy` omits compatibility settings; `modern` specifies mode 15. Each has six
pages: no pressure/no crossing span, no pressure/two rows/crossing span, pressure
without crossing span, then pressure with crossing spans and two/four/one rows.
`series` has eight mode-15 pages with pressure and a crossing span, varying only
the bottom-left text: empty, I, Bottom, four/eight/twelve M characters, twelve W
characters and twelve i characters.

Measured examples (points; native PDF rounding is included):

| Case | Native merged left | Native spacer | Native right | App spacer before correction |
| --- | ---: | ---: | ---: | ---: |
| Modern no pressure/no crossing | 150.05 | 30.00 | 120.05 | 30.00 |
| Modern pressure/no crossing | 174.65 | 25.08 | 100.37 | 8.75 |
| Modern pressure/crossing | 178.61 | 24.24 | 97.248 | 8.75 |
| Legacy pressure/no crossing | 174.65 | 25.80 | 103.61 | 8.75 |

The series also changes the reference application's bottom-left allocation nontrivially: empty text
gets 97.224 pt, Bottom gets 110.060 pt, eight M characters get 120.140 pt, and
twelve M characters get 108.020 pt. Therefore correcting only how the other
columns surrender space is insufficient to reproduce overlapping-span layout.
Repeated equivalent rows leave the native result unchanged.

ECMA-376 Part 1 §17.18.87 describes enlarging spanned columns for minimum content
and proportionally reducing other columns toward their minima; §§17.4.17,
17.4.63 and 17.4.71 define spans and preferred widths. The guidance allows other
algorithms. These controls do not yet establish a normative reference/spec divergence
or the full corrective algorithm. Current prefix pinning concentrates the
required reduction in the adjacent spacer, which is inconsistent with these
native examples. The outside-column correction now shares the reduction by each
column's room above its minimum, preserving the span's already feasible internal
boundaries and rechecking all interval constraints. Browser tests compare the
modern no-crossing cases, with and without pressure, to the reference application within 0.2 pt. They
also exercise editing and reopening the six-page source. Unit tests cover the
allocation rule and editing/export/exact undo for all three packages.

Crossing-span internal allocation is covered by passing native geometry
assertions in `../autofit-crossing-content` on both narrow and wide pages.
The legacy automatic total-width discrepancy
is addressed by the automatic-growth/page-limit controls in
`../autofit-auto-growth`. The full reference set stays available for further
work. Three source packages pass eight schema checks; that validates XML only.

## Consistent preference correction, September 25, 2026

The no-pressure crossing case also exposed an independent preference error:
the first 150pt merged request initially inferred 75/75pt, then the later
80pt individual request replaced the first share without reducing the second.
AutoFit now resolves fully determined, consistent explicit requests together
before distributing content pressure. The resulting 80/70/30/120pt preferences
retain both merged requests. Conflicting or underdetermined requests retain the
existing allocation path; authored XML is unchanged.

The full native boundary probe now checks all twenty reference pages. Both
legacy and modern no-pressure crossing cases must pass the original 0.2pt
tolerance for all five cells before any expected-failure marker is enabled.
The remaining pressure cases were initially explicit expected failures, with every
coordinate difference saved as a test artifact. An unavailable Arial reference
font explicitly skips the native test, as in the existing controls. Import,
reference hashes, page/cell counts and nonfinite geometry fail normally.
The modern editing regression also checks the corrected upper-row boundaries.
These assertions do not certify the unresolved long-text allocation.

## Current verification, October 1, 2026

The September 27 protected-minimum correction (`09135cda`) removed the
remaining expected failures. All five native boundary cases and the editing,
undo/export/reopen case pass on `d08e6d7b`. This checks all 52 native reference
pages (6 legacy, 6 modern, 8 series, 16 narrow and 16 wide), with the original
0.2pt PDF boundary tolerance and the direct reference cell-width comparisons.
Source/reference hash checks remain enabled; there are no pending-failure
annotations. The earlier residual descriptions above are historical results.

The cold first navigation exceeded the default 30-second test deadline;
the full suite passed with a 120-second deadline and unchanged assertions.
This records test startup behavior, not a rendering-performance certification.
These controls do not certify every AutoFit configuration.
