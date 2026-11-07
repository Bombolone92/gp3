# Chart color controls

`tools/chart_colors_fixture.py` independently authors three DOCX controls using
the project's original stacked-chart package shell and lxml. No corpus content
is included. The reference application exported the one-page PDF references,
read-only, without saving the source DOCX. `tools/record_stacked_charts.py
chart-colors` records native PDF path colors, normalized bar geometry and tick
strings, with source/PDF SHA-256 hashes.

- `chart-theme-colors`: explicit accent1, 65% shade and 65% tint; a transformed
  text-color axis and a 50%-luminance background-color gridline.
- `chart-theme-remapped`: the same chart with document accent1 mapped to accent2.
  The reference application applies that mapping to the chart as well as document text.
- `chart-direct-colors`: preset coral, system windowText with a deliberately
  contradictory red lastClr, and linear scRGB (20%, 50%, 80%). The reference application uses the
  current black system color, consistent with the existing system-color controls.

Every shape explicitly includes an empty effect list. Series fill colors and
normalized bar geometry are compared exactly/within 0.001 of plot dimensions,
respectively. Browser checks inspect native fill pixels and the actual editor
canvas, edit surrounding text, preserve all unrelated package parts, undo and
reopen. The existing stacked-chart cases run alongside these controls.

The native reference gridline is #7f7f7f while the shared DrawingML color resolver rounds the
half-luminance value to #808080. The dedicated axis-color assertion records this
one-channel-level residual explicitly; it is not a claim of perfect color
quantization. The category-axis color #d9d9d9 agrees. Plot margins and chart text
layout still use the existing preview policy. Chart-local theme overrides,
nonempty effects and translucent solid fills remain outside editable support.
