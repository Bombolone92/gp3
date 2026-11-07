# Wrapped versus standalone legacy-font advances

`python tools/legacy_continuation_fixture.py` authors four paragraphs from the
project's original reviewed-family OPC/XML scaffold: regular and bold body
paragraphs followed by their continuation text as standalone paragraphs.
No corpus content or font binaries are included. Source and native output
are project test assets under the repository license.

The exact source was opened in the reference application using the reference opener.
Its `Content.EnhMetaFileBits` bytes were written to `native.emf` without saving
the document. `python tools/record_legacy_continuation.py` independently reads
text records, discards whitespace-only records, and checks every advance and
horizontal origin against the paired standalone line and the previous
`empty-gpos-kerning/reviewed-family.emf` reference. All three agree exactly
for both regular and bold. Hashes bind source and both native references.

The optional browser test uses the same private, hash-verified Open Sans 1.10
diagnostic faces as the existing legacy overflow test. Set
`DOCX_TEST_OPEN_SANS_110_DIR` as described in that fixture's README. The font
files are neither installed nor redistributed by this test. It verifies that
the viewer also produces identical glyph origins in the two contexts, and
that SVG shaping advances match the actual canvas fragment widths.

The remaining native/browser difference is therefore not specific to a
wrapped continuation in these controls. This does not identify the underlying
advance/rounding algorithm or establish font-version equivalence for other files.
The original strict 0.25pt native-display test remains unchanged and failing;
no origin compensation, tolerance change or corpus promotion is justified.
