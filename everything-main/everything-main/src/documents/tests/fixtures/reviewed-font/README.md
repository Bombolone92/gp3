# Reviewed missing font

`tools/reviewed_font_fixture.py` manually authors original paragraphs with
explicit Bebas Neue run and paragraph-mark fonts, automatic line spacing,
an exact-height line, and an installed Arial control. The reference application exported
`native.pdf`; the reference script records its glyph origins and document hashes.
The native reference page and browser page were visually inspected.

The reviewed unmodified OFL-1.1 font restores the condensed glyphs. All Bebas
glyph origins differ from the reference application by less than 0.2 pt; automatic baselines differ
by less than 0.15 pt and every line break matches. Tests enforce those bounds,
on-demand same-origin loading, unchanged packages, editing, undo and reopen.
Unit tests cover native priority, unknown names, failure and relative base URLs.

The exact-height Bebas baseline initially sat 3.612 pt above the native reference. The separate
four-font exact-line control now establishes and fixes that baseline rule;
this test also checks the exact baseline within 0.15 pt. The Arial control still
has glyph-origin errors up to 0.766 pt near its final word. No complete rendering
fidelity is claimed, and that gap is not hidden by broadening the font oracle.
The font-availability change itself does not establish a reference divergence; the
exact-line divergence is documented in the exact-font-baseline fixture.
