# Automatic chart plot layout

These 24 original DOCX controls contain no corpus content. The generator
`tools/chart_layout_probe.py` uses the original chart-metadata fixture as an
OPC shell. The reference application opened the controls read-only and exported
the PDFs without saving the sources. No standalone font binaries are supplied
or installed.
`tools/record_chart_layout.py` records source/PDF hashes, magenta chart-frame
and gray plot-border centerlines, and PDF label origins/baselines.

The controls vary Arial, Calibri and Cambria at 6/9/12/18 points; Times New
Roman and Verdana at 9/18 points independently cross-check the inferred font
geometry. Four further Arial 9-point controls vary frame width or height.
The browser checks require those installed fonts to reproduce these references.
Four signed controls use negative-only and mixed-sign caches with Arial 9-point
and Cambria 18-point labels, moving the zero axis away from the plot bottom.

For this explicit-font, automatic-axis subset, let A/D be the native face's
ascent/descent and E its em size, all in the same units. The reference application's category label
band is A+D+2A/3; the value-label gap is half that band. The plot starts after
6.5 points, the widest numeric label and that gap. Its right inset is 11
points; its top inset is max(11 points, 5 points+(A+D)/2). The bottom inset is
6.5 points plus the category label band when zero is the lower bound. With
negative values, category labels sit below the internal/top zero axis and the
bottom inset instead matches the value-label inset at the top. Numeric labels' baseline relative to
the tick is (A-D)/2-(A+D-E)/4; category labels leave D below the baseline at
the bottom of the band. These are observed reference consumer defaults, not lengths
specified by OOXML. No document or font-name condition selects the calculation.

Cambria's small embedded bitmap strikes also round browser advances differently
from the reference application. Chart labels are measured and painted at outline scale, then scaled
to their declared size. Kerning eligibility is determined at that declared
size. Font-box measurement is independent of label contents and includes no
CSS paragraph external leading.

The pre-change renderer used the chart frame height to choose label margins,
even when the source specified a different text size. The first line-height
approximation passed Arial but failed Calibri and Cambria. The checked-in
references retain all those cases; plot and label comparisons use 0.2-point
tolerances. Tests also verify no-edit preservation, surrounding edits,
unrelated package parts, exact undo and reopening. Geometry capture alone is
supplemented by rendered page images for visual inspection.

Relevant ECMA-376 Part 1 clauses are 21.2.2.88 `layout`, 21.2.2.89
`layoutTarget`, 21.2.2.91 `lblOffset`, and 21.2.2.216 `txPr`. Empty automatic
layout does not prescribe the reference application's placement algorithm. These controls do not
establish complete legend, title, long/wrapped-label or custom-axis fidelity.
