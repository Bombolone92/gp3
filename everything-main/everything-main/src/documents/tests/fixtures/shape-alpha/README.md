# DrawingML scRGB and alpha controls

Original OPC/XML authored by `tools/canvas_shape_alpha_fixture.py`, using the
project's original theme control as a shell. No corpus document is redistributed.
The reference application exported the one-page `native.pdf` without saving the source.
`tools/record_shape_alpha_reference.py` records source/PDF hashes, actual PDF
pixels and glyph boxes.

Twelve pairs of overlapping rectangles exercise zero/full/40% alpha, ordered
alpha modulation and offset (including intermediate saturation), linear scRGB,
scRGB tint without intermediate byte rounding, theme colors and a transparent
scRGB theme placeholder. Each foreground is composited over a blue rectangle.
Style references use scRGB; font references omit their optional color.

The behavior agrees with ECMA-376 Part 1 §§20.1.2.3.1–3 (alpha transforms),
20.1.2.3.30 (linear scRGB), and 20.1.4.1.17 (font references). No color-rule
divergence was required. Browser samples allow one channel level for independent
PDF/Canvas alpha-compositing quantization. Text editing, retained shape XML,
reopening and exact package undo are checked as well.

An initial scratch control using consecutive `relativeHeight` values 1–24
unexpectedly placed the first background over its foreground in the reference application. The final
color control uses distinct high layer values; source/PDF evidence for the low
layer behavior remains in scratch (`shape-alpha.docx`, `shape-alpha-word.pdf`).
That separate drawing-order discrepancy is recorded for investigation, not
treated as a proven spec divergence or changed by this color implementation.
