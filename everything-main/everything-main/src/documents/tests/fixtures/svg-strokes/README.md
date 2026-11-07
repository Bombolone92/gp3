Independent SVG/OOXML generator: `tools/canvas_svg_stroke_fixture.py`.
Each document contains ordinary, cropped, grouped and shape-fill SVG pictures
with a deliberately different magenta PNG fallback. Sources live in
`public/fixtures/svg-strokes*.docx`.

The reference application opened each exact source and exported PDF/FlatOPC without saving.
`manifest.json` records source/capture SHA256 hashes. `widths.json` comes from
the first full SVG form's PDF stroke operators, normalized by its rectangle
geometry; `tools/svg_stroke_references.py` reproduces the extraction.

Widths 0.125, 0.25, 0.5, 0.75 and 1 all become 0.14 internal PDF units;
1.5/2/4 become 0.18/0.24/0.48. Rectangle geometry converts at 0.12 internal
units per SVG user unit. Doubling intrinsic viewport dimensions or applying
a 2x group transform doubles the geometry conversion to 0.24 while retaining
the 0.14 floor. A compensating viewport/group scale retains the original
result. Rectangles, paths, lines and circles show the same behavior.

This establishes a native **PDF-export** divergence from fractional SVG stroke
widths. It does not independently establish the reference application's screen rasterization.
The preview compatibility rule follows these native reference exports, retaining
all original SVG/PNG/drawing XML through edits and downloads. Skew, anisotropic
transforms, unresolved percentage/calc widths and non-scaling-stroke remain
unchanged pending direct native evidence. The SVG-to-PDF viewport padding also
differs slightly from the browser and is not corrected by this stroke change.
