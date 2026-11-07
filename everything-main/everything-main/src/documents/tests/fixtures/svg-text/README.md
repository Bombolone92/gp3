# SVG text references

`tools/svg_text_fixture.py` authors fourteen independent SVG pictures in a DOCX,
using python-docx, lxml and the standard library. The contrasting magenta PNG
fallback makes it possible to distinguish SVG rendering from raster fallback.
No corpus artwork or font binary is bundled. The reference application opened the source
read-only and exported `native.pdf` without saving it.

Cases cover default/Arial/Calibri/Times New Roman/unavailable font families,
bold italic, positioned spans with different sizes, centered letter spacing,
an omitted font size, positive/negative spacing, preserved ordinary spaces,
combined word/letter spacing and a nonbreaking space. The reference application's PDF embeds Arial
for missing and unavailable families and uses 12px for an omitted font size.
Installed named families are honored. The browser comparison therefore needs
the same locally installed Arial, Calibri and Times New Roman families.

`tools/record_svg_text.py` measures saturated red ink in the native reference PDF at
four pixels per point, relative to each picture frame. Results are expressed
in intrinsic SVG pixels; JSON hashes bind both the source and PDF. All fourteen
controls compare within one SVG pixel, including raster rounding (observed
maximum about 0.8px). An equivalent CDATA version of the nonbreaking-space case
must paint identically to ordinary XML character data.

The reference application's PDF text advances show no added letter spacing after ordinary spaces,
while nonbreaking spaces retain it. The preview compensates the word-space
advance and preserves nonbreaking-space spacing in generated preview spans.
SVG 1.1 §10.11 describes inter-character spacing independently of word spacing;
this compatibility behavior is recorded in `docs/conformance.md`.
Font defaults are consumer choices rather than asserted specification defects.

Browser and unit checks verify import, image rendering, surrounding edits,
retained SVG/PNG/relationship parts, exact undo and reopening. Active/external
content and unsupported text-path/font-resource features remain rejected.
The reference does not establish every script, font, text-layout property or
the reference application's on-screen rasterizer. Original SVG bytes are never replaced by the preview.
