# AutoFit tab minimum-width controls

These are width references, not complete visual certification.
`tools/autofit_tab_minimum_fixture.py MODE INTERVAL` generates original,
deterministic OOXML. Checked-in combinations are 12/720, 12/360, 14/720,
15/720 and 15/360 (intervals in twips). Each seven-page package has 39 cases,
covering positive/negative/first-line/hanging/right indents, repeated tabs,
text before/after tabs, custom left/right/center/decimal stops, numbers and
currency prefixes, and stops between default-grid positions. Arial is
referenced; no font program or third-party document content is included.

Each table requests 210pt with 100/10/100pt cells and 2pt side margins. The
reference application exports each exact source read-only through
`tools/record-native-cell-widths.ps1 -SourceFullPath SOURCE -OutputJson JSON
-OutputPdf PDF`. The JSON binds source/PDF hashes and records direct cell
widths after PDF export. Repaginate alone can leave those API widths stale:
mode15-360 case 31 initially reports about 76.05pt, but both the PDF and the
initialized cell API give 94pt. The recorder now always initializes print
layout, using a temporary PDF when no saved PDF is requested.

The engine previously omitted tab advances from minimum demand while measuring
them for maximum demand. Tabs now contribute their advance plus the first wrap
chunk of the following field. Legacy modes measure advances from zero and
include the left indent as an implicit stop; modern mode starts from the real
first-line position. A legacy leading tab does not reserve a positive
first-line indent. Default stops continue after the custom-stop range;
decimal stops are skipped for native intrinsic demand. Center/right fields
retain their corresponding offsets. Ordinary text demand remains measured.
Indentation supplies, rather than adds to, the empty-cell writing reserve.

ECMA-376 Part 1 §17.18.87 permits alternative AutoFit algorithms; §§17.3.1.12,
17.3.1.37–38 and 17.15.1.25 cover indentation, custom stops and default stops.
These intrinsic rules record reference compatibility within that latitude, not
an explicit normative contradiction. They do not alter painted tab alignment.

The browser compares all 195 center widths within 0.01pt and neighboring cells
within 0.06pt (one-twip allocation precision), then tests insertion after a tab,
isolated table growth, package preservation, exact undo and editable reopening.
The older `empty-autofit-indents` tab case now joins its native assertions
without a tolerance change: 58pt replaces the former roughly 32pt result.

All fourteen page pairs for mode12-720 and mode15-360 were visually inspected.
They expose separate remaining discrepancies: decimal-tab text is placed
differently inside cells, and repeated tabs at narrow edges can produce
different line counts. The width assertions do not certify those behaviors.
No expected-failure marker hides a width case in this fixture.

Relevant unit/browser checks, schema validation and build passed. Four inspected corpus sources
with main-story table tabs keep all prior cell widths. This does
not change the corpus completion counts.
