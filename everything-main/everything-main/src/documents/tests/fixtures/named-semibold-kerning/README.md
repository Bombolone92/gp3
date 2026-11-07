# Named non-400 font preparation

The original generator `tools/named_semibold_kerning_fixture.py` authors two
minimal, byte-reproducible OOXML packages. Each contains 32 right-aligned 12pt
ASCII samples covering Open Sans SemiBold and Light, regular/bold/italic/bold
italic, tracking 0/0.5pt and kerning thresholds 0/1pt. Optional ligatures are
disabled. Only `enableOpenTypeFeatures` differs between the two documents.
Neither contains corpus content or embedded fonts.

The reference application exported both unchanged controls read-only. The recorder checks
the native selected family and style for every line before recording PDFium
origins. The reference JSON binds the source and retained private PDF hashes.
The PDFs embed historical font subsets and remain private diagnostic artifacts;
only original OOXML controls and numerical native references are committed.

The browser's synthetic-face preparation previously required a CSS weight-400
source. A named semibold registered at 600 consequently failed the whole atomic
preparation, losing ordinary kerning faces as well. Static source matching now
accepts named weights below 700, with CSS normal-weight priority and the existing
style fallback. Named semibold retains its advances; an intrinsic-light
registration receives the existing light/regular synthetic advance adjustment.
Unknown or variable sources retain existing guards. Original fonts and document
bytes are never modified.

Historical Open Sans 1.101 binaries are private diagnostic inputs, not shipped
assets. `diagnostic-fonts.json` binds their hashes. Each is byte-identical to an
installed application font-cache file. Corresponding authored source remains
unverified, so these controls do not justify replacing shipped fonts.

SVG character starts with legacy kerning can describe advance cells and omit
glyph placement offsets. The physical comparison privately converts repaired
legacy pairs to xAdvance-only GPOS and first requires byte-identical painting of
the complete page at DPR 3. Only that equivalent rendering is used as the ink
origin oracle. A baseline changes the original weight-400 selection in Vite's
compiled module, preserving dependency identities. Raw Git module injection is
not a valid baseline.

The maximum native error falls from 4.443451pt to 0.286133pt; 110 glyph origins
improve. Two scalar errors increase while staying within the existing 0.2pt
accepted bound. Previously accepted glyphs retain that bound and unresolved
glyphs do not worsen. Full native agreement still exceeds 0.2pt and remains an
explicit expected failure. No tolerance is widened. Registering light at 300
instead of 400 produces byte-identical complete-page paint.

Both OpenType modes retain editing, unrelated parts, exact undo and edited
export/reopening. Enabled documents now recover overflowing legacy-only tables
for runs retaining legacy pairs (disabled ligatures or tracked runs), while
OpenType/ligature pair omission remains unchanged. Valid-only modern tables,
active GPOS and variable/unknown families are untouched. Both mode comparisons
retain the strict 0.2pt expected failure. Remaining rounding, other scripts and
historical source provenance remain gaps; corpus document #318 is not complete.

Reproduce controls with `python tools/named_semibold_kerning_fixture.py`, or pass
an output directory to avoid rewriting files open in the reference application. After opening with
the reference-application helper, export with `tools/export-reference.ps1`, then run
`python tools/record_named_semibold_kerning.py`. Run
`tests/browser/named-font-kerning.spec.js` locally; supply the documented private
font directory in `DOCX_TEST_NAMED_FONT_DIR` for physical checks. Without it,
workflow checks run and historical physical checks explicitly skip.

Relevant clauses: ECMA-376 Part 1 §§17.3.2.19 (`kern`), 17.3.2.26 (`rFonts`),
17.3.2.35 (`spacing`), and MS-DOCX's `enableOpenTypeFeatures` and `w14:ligatures`
extensions. No new reference/spec divergence is claimed.
