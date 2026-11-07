# Horizontal text placement diagnostics

With the local playground running, capture body caret origins without editing
the source:

```powershell
node tools/capture-body-char-origins.mjs SOURCE.docx APP.json
python tools/compare_pdf_char_origins.py WORD.pdf APP.json COMPARISON.json --reader metadata
```

Use the existing bundled Python runtime with `pypdfium2` when it is unavailable
in your shell. No new package or font installation is required. PDFium and its
Python binding use permissive licenses; do not replace them with an AGPL PDF
engine. The native reference must have been independently exported by the reference application
from the same unchanged source. The capture records the source hash, and the
comparison records both input hashes. Keep reports containing corpus text
private; commit only aggregate evidence.

The browser capture disables embedded-font decoding and registration through
a verified module route. Its font-source lookup returns `null`, preserving
ordinary installed CSS font preparation. An empty array would claim an embedded
family with no usable faces and bypass installed fonts, invalidating both
pagination and position comparisons. The output explicitly records this font
scope and guard verification. It does not request Local Font Access or install
fonts. References dependent on an unavailable embedded face remain unresolved;
this isolation is not evidence of the production embedded-font path's fidelity.

The capture uses layout caret stops and display baselines, converted from CSS
pixels to points. It applies display capitalization and the fragment's vertical
script/position offset, while retaining source offsets. These are not painted
glyph outlines. It excludes whitespace, expanding uppercase mappings, spans
whose source length differs (such as atomic field caches), rotated table cells,
drawing text and page stories. Expansion/non-source-span exclusions are counted
in the report. Missing caret stops are omitted, so compare supplied coverage
with the document separately.

The comparator uses PDFium's public
[text API](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_text.h)
to read character Unicode, effective matrices and origins. It does not extract
font programs, outlines or font streams. Horizontal baseline classification
uses the matrix baseline axis, allowing synthetic italic shear. It joins
characters on the same baseline independently of PDF text-run boundaries,
requires exact Unicode matches, bounds geometric pairing, prevents reuse and
leaves equidistant candidates ambiguous. It is intended for ordinary left-to-right
horizontal lines, not a general bidi or vertical-text matcher.

Mixed-baseline lines (for example superscripts) pair each contiguous baseline
span independently. The entire line must match before native positions are
consumed. Exact Unicode, geometric bounds, ambiguity and no-reuse checks still
apply; a missing raised span cannot silently turn a partial line into a match.

Use `--reader metadata` when checking explicit PDF text operators rather than
PDFium's interpretation. This optional reader uses the bundled MIT-licensed
pdfminer.six. It resolves PDF-declared ToUnicode/standard simple-font encodings,
widths, transforms and text rise. Its font resource manager removes FontFile,
FontFile2 and FontFile3 references before constructing fonts, preventing font
program decoding or glyph-map fallback. CID fonts require explicit ToUnicode;
Type3 glyph programs, rotated pages and multi-character glyph mappings reject
with a reported error. It never uses expected document characters to repair
PDF identities. Keep the selected reader in the result when reporting evidence.

In the retained #81 native reference, PDFium reports the address's WinAnsi text as
uppercase despite its mixed-case PDF text operators and visual rendering. The
metadata reader preserves the declared mixed case. This is a reader discrepancy,
not evidence that the editor should paint uppercase or case-fold its comparator.

`--allow-unknown` optionally pairs PDF control-code identities with expected
positions only when the line has a matching Unicode anchor. Every such glyph
remains explicitly unverified and retains its native identity. Run the default
exact comparison too; unknown pairing does not prove the character is correct.

Run `python tests/pdf_char_origins_test.py` for pairing regressions and the
independent native reference. Placement diagnostics supplement visual review;
they do not establish glyph-shape, artwork, editing or whole-document equivalence.
