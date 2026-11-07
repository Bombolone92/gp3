# Paragraph gap line units

`tools/paragraph_line_units_fixture.py` authors original OOXML. The reference application exported the 34-page reference without saving the source. A separate
eight-page `paragraph-line-units-default-24` fixture changes document defaults
from 12pt to 24pt and enables explicit compatibility mode 15; the main fixture
omits compatibility settings. `tools/record_paragraph_line_units.py` extracts baselines and
source/PDF hashes. All labels and fixture contents are original.

Each page contains four equal-format paragraphs. The extra B-to-C baseline
distance relative to A-to-B isolates the tested paragraph gap from font metrics.
Controls cover before/after, sizes 10/12/20/30pt, automatic/double/exact/minimum
line heights, 0/0.5/1/1.5 line gaps, competing 36pt spacing, mark size versus
run size, style inheritance and explicit automatic-spacing false.

The reference application uses 12pt per paragraph-spacing line unit, independently of all tested
font sizes, document defaults and inter-line heights. A nonzero line-unit
value overrides the corresponding point spacing; zero leaves the point value
active. Thus zero lines plus 36pt gives 36pt; one line plus 36pt gives 12pt.
This qualifies the line-unit description in ECMA-376 Part 1 §17.3.1.33.
MS-OI29500 §2.1.60 documents nonzero line-unit precedence across the hierarchy:
https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/264a0139-8174-4574-b20d-ab778e770931

Imported attributes remain intact. Point edits explicitly set the competing
line-unit and automatic flags to zero, including when inherited; style removal
removes all three corresponding attributes. Browser tests compare painted gaps
within 0.25pt of the native reference PDF, then edit, export, reopen and undo to exact OPC
parts. Unit checks cover resolution, bounds and direct/style point overrides.

An additional scratch export changes inherited before/after gaps to 7pt.
The reference application reopens it as 34 pages and measures both gaps at 6.98pt,
confirming that explicit zero mode flags override the inherited line units.

Automatic spacing remains unsupported. The generator's `--automatic` probe
and its six-page `paragraph-auto-spacing` native reference record approximately
14pt for enabled automatic before/after in these controls, versus 12pt for the
disabled flag with one line. That observation alone does not establish HTML
automatic spacing, compatibility switches or table-edge suppression. Active
document grids are not established by these controls either.
