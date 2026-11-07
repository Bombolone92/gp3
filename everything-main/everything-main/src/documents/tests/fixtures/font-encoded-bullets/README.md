# Font-encoded numbering labels

`tools/font_encoded_bullets_fixture.py` authors original OPC/XML without corpus
content. The reference application exported `native.pdf` read-only. The independent
`record_font_encoded_bullets.py` records 24 body baselines and 12 marker ink bounds
and areas at 288 DPI, with SHA-256 hashes of the source and native PDF.

Twelve one-page controls cover Wingdings U+F09F/U+F0A7/U+F0FC, Wingdings 2 U+F0A3,
Webdings U+F067 and Symbol U+F0A8 at 10/20pt, with Arial 10pt body text and automatic
single spacing. All page pairs were visually inspected. The browser checks body
baselines within 0.25pt, absolute glyph edges within 0.75pt and ink area ratios
between 0.75 and 1.25. These allow native raster differences, not arbitrary glyph
substitution. native reference comparisons require the installed reference fonts.

The importer previously rejected private-use label text except one Symbol bullet.
It now preserves literal labels and uses the existing resolved font for layout
and painting. No font-specific mapping is added. The established Symbol U+F0B7
readable fallback remains unchanged. Missing custom fonts retain their original
code points and use existing font fallback; a missing-glyph box is possible and
does not claim fidelity without the correct font. A separate browser scenario
checks this case without requiring reference fonts.

Unit tests cover exact package undo, unrelated-part preservation, label/font
retention and generated numbering. Browser checks repeat native glyph checks
after editing, undo and exported-file reopening. No font files or third-party
rendering code are distributed. ECMA-376 Part 1 §§17.9.11, 17.9.24, 17.3.2.26
specify literal label text and its run/font properties; no new reference/spec
divergence was observed in these controls.
