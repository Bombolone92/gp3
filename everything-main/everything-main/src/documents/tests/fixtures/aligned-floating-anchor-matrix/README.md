# Floating table alignment width and anchor matrix

These eleven packages are manually authored by
`tools/aligned_floating_parity_holdout.py`. They reuse only our six-part XML
scaffold; no corpus content, font programs or artwork is included. All declare
Arial. Regenerate into fresh directories using the recorded parameters below.
Every DOCX and case manifest has been verified byte reproducible. Never replace
a source while the reference application has it open.

| Folder | Horizontal anchor | Compatibility | Rows | Left/right cell margin (twips) | Position |
| --- | --- | --- | --- | --- | --- |
| page-15 | page | 15 | 18 | 108/108 | inside/outside |
| text-15 | text | 15 | 18 | 108/108 | inside/outside |
| margin-12 | margin | 12 | 18 | 108/108 | inside/outside |
| page-12 | page | 12 | 18 | 108/108 | inside/outside |
| text-12 | text | 12 | 18 | 108/108 | inside/outside |
| asymmetric-12 | margin | 12 | 18 | 72/216 | inside/outside |
| reverse-12 | margin | 12 | 18 | 216/72 | inside/outside |
| center-12 | margin | 12 | 18 | 108/108 | center |
| short-12 | margin | 12 | 3 | 108/108 | inside/outside |
| center-short-12 | margin | 12 | 3 | 108/108 | center |
| asymmetric-short-12 | margin | 12 | 3 | 72/216 | inside/outside |

Pass `--horizontal-anchor`, `--compatibility-mode`, `--rows`, `--cell-left`,
`--cell-right`, `--center` and `--output-directory` as appropriate. Defaults
are margin/15/18/108/108/inside-outside. Labels are unique identifiers; the
manifest's predicted physical page ranges specify parity, including short
variants where the original identifier suffix no longer denotes parity.

The reference application confirms eleven pages for every long variant and seven pages
for each short variant. The `reference.json` files contain declared Unicode
text origins, bound to source and PDF hashes. Guarded native capture preserved
source bytes, Saved state, view, zoom and selection. FontFile references were
removed before metadata construction; glyph-program fallbacks were rejected.
PDF and EMF files remain private; these checks do not certify native ink.

Unequal margins distinguish the sum of exterior writing margins from doubling
either margin. Legacy center/right alignment uses that writing width, while
modern alignment retains its outer-frame width. The short controls cover
production placement, grid preservation, edits to all four tables, exact
package/print undo and export reopening at 100%/75%. Long controls exercise a
first-physical-page placement with actual runtime verification. Horizontal
multi-page alignment is now supported, with initial numbering and leading
flow covered separately. Vertical/booklet/story/overlap guards remain. The
earlier legacy-width report remains historical evidence.
