# Empty positioning tables and legacy kerning

`tools/empty_gpos_kerning_fixture.py` manually authors two original DOCX
controls. Each contains 16 right-aligned lines: four Open Sans faces, kerning
thresholds of zero and one point, and disabled or standard/contextual
ligatures. Only `enableOpenTypeFeatures` changes between documents. No corpus
text, artwork, or font files are included in the DOCX packages.

The reference application exported the unchanged controls read-only to the
retained one-page PDFs. Both pages were rendered and visually inspected.
`tools/record_empty_gpos_kerning.py` records native line starts, baselines,
font resource names, and source/PDF hashes. The two documents pass four
standard-MCE XML schema checks. This is not a full rendering-conformance claim.

With OpenType disabled, enabling kerning shortens each sample by over five
points. With OpenType and standard/contextual ligatures enabled, the same
sample instead has the width of its unkerned counterpart. Compare like
ligature settings: bold italic also changes ligature width. This extends the
existing legacy-only reference behavior controls to fonts with an empty GPOS
script/language scaffold. It does not establish a new OOXML violation.

The font metadata reader now treats a structurally valid empty GPOS as no
positioning capability. Active, unknown, malformed, and variation-bearing
tables retain conservative handling. The existing authorized-font preparation
can therefore omit legacy pairs on the reference application's OpenType/ligature path. No family
names, text-dependent offsets, or font replacement are added to the renderer.

The optional browser test uses unmodified Apache-2.0 Open Sans 1.10 faces from
google/fonts revision `90abd17b4f97671435798b6147b698aa9087612f`, independently
obtained for diagnosis. `diagnostic-fonts.json` records their hashes; these
binaries are neither installed nor shipped. Set `DOCX_TEST_OPEN_SANS_110_DIR`
to a directory containing the four documented `OpenSans-1.10-*.ttf` files.
The test loads them only in its private browser page and supplies an explicit
font-catalogue grant. It verifies normal document preparation and the four
native OpenType/ligature line starts within 0.2pt. Without those external
assets, this test explicitly skips; unit tests need no external fonts.

The legacy path now repairs the unambiguous format-0 subtable length overflow
in an already authorized static font. A single sorted horizontal table must
account exactly for its pair count and have the matching wrapped 16-bit length.
The private rendering copy splits records into valid-length subtables and drops
only a proven empty GPOS. Original font and document bytes remain untouched.
Unknown coverage, multiple source subtables, active GPOS, variable fonts and
mixed recoverable/unrecoverable families retain the existing fallback. No new
enumeration, permission request, font asset or network source is introduced.

`reviewed-family.emf` is the reference application's `Content.EnhMetaFileBits` output from
the manually authored `public/fixtures/reviewed-family.docx`. It contains text
and drawing records, not font binaries. `tools/record_reviewed_family_display.py`
records the hash-bound display glyph origins independently of the retained PDF
oracle. The EMF window/frame scale is 0.12pt per logical unit. Full-fragment SVG
origins are checked against canvas advances before comparison. The regular and
italic sample display/PDF origins themselves differ by up to 0.2501/0.4358pt;
they are distinct output oracles, not interchangeable references.

The optional overflow browser test verifies reduced overall error without making
any Open Sans line worse, then no-edit export, editing, unrelated parts, exact
undo and reopening. Its
final strict 0.25pt display check remains an expected failure: two wrapped
continuation lines still differ by up to 0.281pt. The original 0.35pt PDF test
is unchanged. Corpus #39 remains partial: bundled 3.003 fonts are unchanged,
and exact corresponding source for the diagnostic 1.10 binaries has not been
verified for redistribution. OpenType-enabled text with ligatures disabled is
also outside this repair's current selection path. Paragraph-mark substitution
prevents claiming baseline equivalence for the 16-case controls.

References: ECMA-376 Part 1 §17.3.2.19 (`kern`), §17.3.2.26 (`rFonts`), and
the `enableOpenTypeFeatures` interaction documented in the existing
`opentype-kerning` fixture README. Font table validation follows the OpenType
GPOS header, ScriptList, Script, and LangSys structures.

The OpenType [kern table specification](https://learn.microsoft.com/en-us/typography/opentype/spec/kern)
defines the unsigned 16-bit subtable length, sorted format-0 pairs and additive
horizontal subtables. The reference application's acceptance of an overflowing original is a font
compatibility behavior; the derived table conforms to those length limits.
