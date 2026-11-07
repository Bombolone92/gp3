# GPOS-only kerning in legacy document mode

`tools/gpos_only_kerning_fixture.py` independently authors ten OOXML controls.
Each compares explicit kerning off/on in Bebas Neue or Source Sans Pro against
an Arial control. Bebas covers absent, disabled and enabled
`enableOpenTypeFeatures`, with none/standard ligatures. Source Sans Pro provides
an unrelated GPOS-only family in both explicit modes. Two further controls cover
regular, bold, italic and bold-italic Bebas, including synthesized oblique. The reference application exported
the ten one-page PDFs. `tools/record_gpos_only_kerning.py` records all 40 lines
and binds the source/PDF bytes to hashes. No font files are embedded or copied
from the reference application's font cache.

These controls omit `compatibilityMode` (legacy mode 12). The reference application ignores
GPOS-only kern features with their disabled/absent OpenType flag. Enabling the
compatibility switch enables those pairs even with ligatures set to none.
Arial has a legacy kern table and still kerns in disabled mode. Thus turning
off Canvas kerning for all text would break valid native and fallback behavior.
Mode 15 has a different omitted-flag default; see the independent
[application-default controls](../script-kerning-defaults/README.md).
This is observed reference shaping compatibility, not an ECMA requirement specifying
a font-layout backend; `w:kern` (Part 1 17.3.2.19) still supplies the size threshold.

The private derived font empties only the GPOS `kern` feature's lookup list.
Other feature/lookup data, outlines, metrics, script/language mappings and GSUB
remain unchanged; fallback fonts keep their own kerning. Original font binaries
and document declarations are preserved. Unknown, variable, mixed-width and
legacy-kern families are not converted. The family registers atomically and is
reused until local-font authorization changes. Synthetic advances receive the
same treatment when their source is supported. Unsupported font variants keep
the previous renderer rather than registering a partial family.

Before the fix, the disabled Bebas control has a maximum 6.084-pt glyph-position
error; after it, 0.108 pt. The earlier reviewed-font control improves from
5.514 pt to 0.168 pt. The enabled-mode Arial row has the same 0.214264-pt error
before and after; separate strict expected-failure tests retain it. All other
new control glyphs must stay within 0.2 pt, and every baseline within 0.2 pt.
SVG full-fragment origins are checked against Canvas advances; prefix caret
positions are not used as the native glyph oracle.

Browser checks cover native positions, fallback glyphs, unchanged no-edit
packages, edits, unrelated parts, exact undo and reopening without new loads.
Unit checks cover malformed fonts, feature preservation, checksums, styles,
permission changes, concurrent preparation and atomic failures. No claim of
pixel identity or complete corpus fidelity follows from these bounded controls.
