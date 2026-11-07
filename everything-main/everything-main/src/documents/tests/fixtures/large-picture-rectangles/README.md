# Large DrawingML source and destination rectangles

Original XML and the generated quadrant PNG use `canvas_picture_fill_fixture.py`
(Python stdlib, python-docx MIT and lxml BSD). No corpus artwork or third-party
document engine is included. The reference application exported the eight-page PDF.

The controls exercise destination outsets on all four sides, mixed positive and
negative offsets, source outsets, an equivalent percentage-literal source value,
and cancelling source/destination mappings. Offsets beyond the old 1000% cap
remain bounded by the displayed frame and its clip; the source bitmap is not
resized or rewritten. The native recorder retains 30,061 interior color samples,
including transparent/white regions, bound to source and PDF hashes.

Part 1 §§20.1.8.55 (`srcRect`), 20.1.8.56 (`stretch`), 20.1.10.40
(`ST_Percentage`) and `CT_RelativeRect` describe these rectangles. Part 4's
transitional `ST_PercentageDecimal` restricts `xsd:int`, not an application
1000% bound. The reference application accepts these standard values; no divergence is claimed.
The engine retains its positive viewport and 0.001% precision requirements.
Percentage literals outside the representable signed 32-bit range remain
unsupported even though the percentage-string branch permits larger values.

Run `python tools/large_picture_rectangles_fixture.py`, export the resulting
`controls.docx` to `native.pdf` in this directory using the reference-application helper,
then run `python tools/record_large_picture_rectangles.py`. Browser tests compare
the native samples and verify edit/export, no-edit bytes, unrelated parts,
exact undo and editable reopening. Additional UI coverage authors a large crop,
reopens it, changes alt text while retaining the crop and resets it.
