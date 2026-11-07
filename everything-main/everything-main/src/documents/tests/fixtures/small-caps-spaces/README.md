# Native small-cap spaces and line metrics

Original control authored by `tools/small_caps_space_fixture.py` using the
existing python-docx dependency. It contains no corpus artwork or font binaries.
The reference application opened the source read-only and exported the four-page `native.pdf`.
The 37 cases test ordinary spaces after lowercase/uppercase, repeated and leading
spaces, punctuation/digits, NBSP, en/em/thin spaces and a tab. They include
Constantia 21pt, Calibri Light bold 42pt and Arial 11pt; split runs; color, italic,
size, font and capitalization changes; centered text; narrow wrapping; and a
manual line break. The recorder retains source/PDF hashes and raw glyph origins.

Ordinary U+0020 spaces use the reduced small-cap size regardless of neighboring
case, punctuation or a run boundary. Other tested space characters retain their
authored size, and tabs retain their separate tab-stop behavior. Automatic line
allocation uses authored font metrics even for entirely lowercase text. The
initial hypothesis that only spaces following lowercase shrink was disproved
by measuring neighboring glyph origins in the expanded controls.

PDFium synthesizes some spaces with a 1pt reported font size. Those values are
not real paint sizes and are never used as expected renderer values. The browser
test instead compares all 286 non-whitespace glyph origins and baselines, including
the effect of each intervening space and wrapping. Maximum measured differences
are 0.213pt horizontally and 0.152pt vertically. All four full-page pairs were
also inspected. Editing tests preserve source case, sizes and unrelated parts
through no-edit download, insertion, export/reopen and exact undo.

These controls extend the documented compatibility behavior for ECMA-376
Part 1 §17.3.2.33, whose text describes lowercase glyph reduction. The reference application's
proportional sizing differs from the specified fixed two-point reduction; the
space treatment and automatic line metrics are retained as explicit native
evidence. No source text or native coordinates were adjusted to fit the engine.
