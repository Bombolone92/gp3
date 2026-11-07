# Text-outline luminance transforms

Original OOXML controls from `tools/text_outline_luminance_fixture.py`, using
our existing original outline and color OPC packages. No corpus artwork or font
binaries are included. The reference application confirmed the exact source and
exported the one-page PDF. `tools/text_outline_luminance_reference.py` reads
native PDF stroke colors (including gray operators), records hashes and renders
the 96-DPI image. Expectations do not come from the document renderer.

Sixteen cases cover literal/theme colors, luminance modulation and offset,
both transform orders, zero, negative and greater-than-100% values, white/black
and a dark RGB edge. Relevant definitions are MS-DOCX sections 2.6.3.19, 2.6.3.30
and 2.6.3.33 ([CT_Percentage](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/690e8fcb-f555-4da7-8155-6848901a34df),
[CT_SchemeColor](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/133bd2fe-ad4c-4422-a120-9c3a1a3a4e30),
[CT_SRgbColor](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/10a451b3-6054-4e0a-b1b2-b68fe9316533))
and ECMA-376 Part 1 sections 20.1.2.3.20–21.

Import applies ordered HSL lightness transforms, clamps at each step and rounds
RGB only at the end. Unit expectations were independently checked with Python
colorsys. Ten of sixteen native reference colors differ by one channel value; the
native quantization algorithm is still unresolved. This fixture documents that
precision gap rather than claiming exact native colors or a normative divergence.
The browser mask check uses RGB tolerance 3 and requires 99% agreement within
one pixel. It skips only the final white-on-white row, whose resolved color is
unit tested, and the deliberately edited first row after reopen.

No-edit bytes, edits, export/reopen, unrelated parts and exact undo are checked.
Unsupported transforms, opacity, and percent-string lexical values remain
guarded. The shared DrawingML luminance calculation is unchanged; W14 parsing
uses its own namespace and signed-percentage validation. No paint-time color
conversion or raster probe was added.
