# Tracked pair modes: pending glyph fidelity

`tools/tracked_pair_modes_fixture.py` independently authors two minimal OOXML
packages, with byte-reproducible ZIP output. Each has 48 right-aligned 12pt
samples in Arial, Goudy Old Style, Constantia and Palatino Linotype. Samples
combine tracking of -0.3/0/+0.3pt, none/standard ligatures, and kerning thresholds
of 1/24pt. Only the document's `enableOpenTypeFeatures` switch differs between
the two packages. There is no corpus text, artwork or font file in either DOCX.

The reference application exported both unchanged sources read-only. The recorder
verifies the selected font independently for every line, then records PDFium
character origins and baselines. Hashes bind each source and retained PDF.
Both native pages and browser pages were visually inspected.

The enabled Goudy zero-tracking, standard-ligature sample is 5.28pt wider than
its disabled counterpart. Its none-ligature and tracked samples retain the
legacy pair response. This supports the existing selective OpenType policy;
it does not justify removing all legacy kerning in enabled documents. Palatino
still has a 0.24pt switch-dependent width difference across tracking settings.
No new OOXML specification violation is established here.

The browser test verifies all 96 text/origin counts, Canvas/SVG advances,
baselines, one-page layout, editing, unchanged other package parts, exact undo,
and fresh reopening. Full glyph-origin fidelity remains an expected failure at
the existing 0.2pt bound: the maximum observed error is 0.494385pt. That bound
has not been widened. These installed-font controls do not reproduce the
historical font overflow or prove that #318's 1.42pt heading error is repaired.

Reproduce sources with `python tools/tracked_pair_modes_fixture.py`; an optional
output-directory argument permits byte checks without rewriting open files.
Open each source with the reference-application helper, export with
`tools/export-reference.ps1`, then record with
`python tools/record_tracked_pair_modes.py`. Run the browser test locally with
the four reference families installed. Missing families produce an explicit
skip rather than a passing font comparison.

Relevant clauses: ECMA-376 Part 1 §§17.3.2.19 (`kern`), 17.3.2.26 (`rFonts`),
17.3.2.35 (`spacing`), and the MS-DOCX `enableOpenTypeFeatures` compatibility
setting and `w14:ligatures` extension. No renderer or font assets change.
