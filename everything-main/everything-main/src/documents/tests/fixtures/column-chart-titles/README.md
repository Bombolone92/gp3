# Automatic rich column-chart titles

Ten original controls built by `tools/column_chart_titles_fixture.py` from the
original chart-layout OPC shell. No corpus artwork is included. The reference
application exported the PDFs from read-only sources. `reference.json`
records source/PDF hashes, plot geometry and PDF text positions using
`tools/record_chart_layout.py`.

Controls cover 6/11/18-point Arial, mixed-size/color/bold runs, overlay,
ordinary wrapping, unbroken-word wrapping, negative values and two widths of
long text. The reference application places the title box 6pt below the chart top with 3pt horizontal
and 1.5pt vertical padding. Automatic text width is limited to 80% of the chart
width minus horizontal padding. Lines share a baseline across rich runs and
use the largest ascent/descent. Nonoverlay titles reserve 20pt plus text height
above the plot. Overlay titles leave plot bounds unchanged. A title does not
increase the negative-value chart's bottom tick margin.

The two repeated-i probes contain 319 characters. The reference application displays only 255,
including inter-word spaces, while the source rich text remains intact. The
renderer follows this observed display limit and preserves the entire XML.
This is a measured reference behavior, not a source truncation rule. The
controls establish the behavior for the supported BMP Latin text subset.

The browser regression compares native plot and label geometry within 0.2pt,
records rendered pages, and checks editing, exact undo, untouched package parts
and export/reopen. Current scope excludes manual title layout, formula-linked
titles, decorated or complex-script text and rich-text line-break elements.
