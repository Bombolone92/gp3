# Image recovery control

Generate with `python tools/image_recovery_fixture.py`. Original, independently
authored XML and PNG data using only Python's standard library. No third-party
assets or document engine.

Both files contain a styled heading, two inline pictures, a table, a numbered
paragraph, a header, and nondefault page dimensions/margins. Only image2.png's
compressed pixel stream differs. The broken variant has readable PNG dimensions
and valid OOXML, but cannot be rasterized.

Expected: the broken picture keeps its authored layout space; the other picture,
text, styles, table, numbering and header remain rendered. Only that picture's
pixels may differ. The preview is read-only and downloads the exact input bytes.
`broken-background.docx` additionally references the same broken PNG as a tiled
page background; the solid page color and body must still paint normally.
This is recovery behavior, not a reference/spec divergence. ECMA-376 Part 1 §§17.4,
17.7, 17.9, 17.10 and 20.4 define the retained structures.
