# Simultaneous capitalization flags

The original `tools/combined_caps_fixture.py` writes 48 OOXML controls. Four
flag pairs (00, 10, 01, 11) cross normal/caps/small-caps inheritance and direct,
paragraph-style, character-style and first-row table-style declarations.
The reference application exported the four-page `native.pdf` without saving the
source. `tools/record_combined_caps.py` records actual glyphs and font sizes,
with source/PDF hashes. All control text is original.

ECMA-376 Part 1 §§17.3.2.5 and 17.3.2.33 prohibit caps and smallCaps on the
same run. The reference application nevertheless renders them, including both enabled. This is
an explicitly supported reference/spec divergence. Effective caps takes precedence
over effective smallCaps. Character-style flags toggle independently against
inherited formatting; direct, paragraph and table declarations set the flags.
For example, a caps paragraph plus a character style declaring both flags on
renders small caps, whereas a normal paragraph renders full caps.

The importer retains both declarations. Serialization preserves unchanged XML
and can write both flags when rebuilding properties. The style dialog retains
the imported combined choice instead of incorrectly displaying Inherit.
Unit and browser checks compare glyph case and size to the reference application, preserve source
text and unrelated OPC parts, and verify edit/reopen and exact undo.

Primary specification excerpt:
https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.smallcaps

These controls establish simultaneous declarations at one level, including
inheritance from a single enabled form. They do not establish every possible
multilevel mixture of separately declared competing positive flags.
