# Table label/control metric isolation

Original OOXML created by `tools/table_prompt_metrics_fixture.py`; no copied
corpus artwork, prose, proprietary engine or font assets. Six pages vary
paragraph-style versus direct 18pt bold Arial formatting and ordinary text,
temporary inline controls and persistent inline controls. Each has the same
fixed two-cell row, paragraph spacing and cell margins. The short `W:` glyph
label is an independently authored measurement string.

The source passes document/style/settings schemas. The current browser opens
six editable pages and reports identical label origins (47.50830078125pt,
65.3828125pt) in all six cases. This rules out a browser wrapper-dependent
placement difference in this control; it does not establish native agreement
or reproduce the original pack's baseline discrepancy by itself.

Six completed native table-range EMFs are now retained, with source/capture
hashes and a bounded recorder in `tools/record_table_prompt_metafiles.py`.
The reference application records the same `W:` origin (95, 148), Arial Bold descriptor,
advances (141, 51), and border rectangles in every case. This independently
rules out a wrapper-dependent placement difference for this control. The
recorder refuses replacement fonts, mapping/alignment changes, unexpected
border operations and a second EMF+ drawing stream. EMF+ state envelopes are
checked; no font programs or proprietary corpus resources are included.

`tools/capture_open_table_prompt_metafiles.ps1` reproduces detached ranges
from the exact helper-opened saved document through the running-object table;
it never binds/opens another document or changes application UI. Capture into fresh
scratch outputs, then copy the six ranges and capture metadata only after
checking unchanged source. Native ranges have no inferred page translation.
The physical frame rounds to hundredths of mm; its horizontal logical unit is
0.12pt and its vertical unit is approximately 0.12005pt. The first-cell border
center is (4, 4), so the baseline is 144 logical units below that center. This
control does not reproduce the corpus pack's roughly 0.536pt baseline gap.
Nested-table/row/border context remains to be isolated. No renderer correction
or normative contradiction is claimed.

The separate PDF export remains pending in a live helper-opened exact-moniker
process. The source stays unchanged. `record_open_table_prompt_metrics.ps1` exports only
an exact saved six-table/four-control source to fresh output files; it neither
opens/closes the reference application nor changes its UI. After successful export,
`record_table_prompt_metrics.py` verifies native font/size, six page identities,
source/PDF binding and unchanged source before recording origins. Do not use
partial outputs as references or restart a still-live export.

Relevant properties: ECMA-376 Part 1 §§17.3.1.33 (spacing), 17.3.2.38 (sz),
17.4 (tables) and 17.5.2 (structured document tags). The baseline question is
native metric compatibility, not a demonstrated normative contradiction.
