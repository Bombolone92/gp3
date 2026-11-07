# Native doughnut chart controls

Original OOXML generator: `tools/doughnut_charts_fixture.py`. It uses this
project's original chart package as an OPC shell; none of the corpus artwork
or data is redistributed. The reference application opened the unchanged source and
exported the retained 16-page PDF. `tools/doughnut_reference.py` binds the
source and PDF by SHA-256 and records 14,313 stable pixel samples relative to
independently located PDF chart frames, plus title glyph origins.

Controls cover square/wide/tall frames, 10/50/90-percent holes, quarter turns,
unequal/negative/zero values, multiple rings, manual plot rectangles, generated
series-name titles and series-level deletion overriding percentage labels.
Title controls vary placement, frame size and font size (10/14/20 points).
All slice fills and 1.5pt white outlines are explicit.

Native observations:
- Segments start at twelve o'clock and advance clockwise. The first-slice angle
  rotates their start clockwise. Negative values use absolute magnitudes; an
  all-zero series has no visible ring. Earlier series occupy inner rings.
- Hole size is the inner diameter as a percentage of the outer diameter.
- Automatic plot geometry in these no-legend controls centers a circle with
  11pt clearance from the shorter frame dimension. Manual plot rectangles use
  their declared fractions; the circle fits centrally inside that rectangle.
- A title without explicit text derives its text from the single series name.
  Manual edge coordinates position its text box; they are not its glyph origin.
- Series `dLbls/delete=1` suppresses chart-level `showPercent=1`.

The browser regression compares all 14,313 retained samples exactly and title
origins within 0.2pt, before and after editing/export/reopen. Undo restores the
original package parts. This verifies chart-local rendering; paragraph/table
placement is a separate layout contract and corpus completion is not implied.
