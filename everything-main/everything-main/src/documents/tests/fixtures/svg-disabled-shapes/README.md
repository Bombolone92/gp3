# Disabled geometry inside translucent SVG groups

This independent control is authored by `tools/svg_disabled_shape_fixture.py`.
Its four identical groups differ only in an extra empty rectangle, circle or
ellipse using a gradient and stroke. SVG 1.1 §§9.2–9.4 disable rendering when
the corresponding dimension/radius is zero, including the unused stroke.
No corpus artwork, fonts or third-party document engine is included.

The reference application was opened on the exact source through the reference-application opener, then
the visible Saved document was observed without opening, saving or quitting
the reference application through COM. Its first inline range returns one cached 900×600 PNG inside
the outer metafile, rather than the separate intrinsic group strips found in
older controls. The four crop regions are byte-identical in RGBA. This proves
empty-shape invariance in this native capture; it does not prove every browser
pixel or intrinsic group bound matches the reference application. Capture metadata, source, metafile,
PNG and crop bytes are hash-bound in `reference.json`.

Before the fix, the browser corrected only the first group: each empty shape's
unused paint/stroke disqualified its whole group. After the fix all four groups
have identical layer pixels. Original SVG/package parts stay intact. The browser
case also checks no-edit equality, editing, unrelated parts, exact undo and
reopening. A separate case retains a painted zero-length round-capped line.

To reproduce, open `public/fixtures/svg-disabled-shapes.docx` through the reference-application
opener and verify the exact control is visible and Saved. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/capture_svg_disabled_shapes.ps1 -OutputRoot C:\scratch\fresh-capture -ExpectedSha256 2ebbfc702384d258554b5e54d817a02bd1b5ea4626eca488bb20ad0770c1805d
python tools/record_svg_disabled_shapes.py C:\scratch\fresh-capture --output-folder C:\scratch\fresh-reference
python -m unittest discover -s tools -p test_svg_disabled_shapes.py
```

Use fresh capture/reference directories; both tools preserve existing evidence.
The fixture generator likewise refuses to replace an existing source.
