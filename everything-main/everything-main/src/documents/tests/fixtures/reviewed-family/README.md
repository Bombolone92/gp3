# Reviewed multi-face families

`tools/reviewed_family_fixture.py` manually authors original regular/bold
Oswald headings and regular/bold/italic/bold-italic Open Sans paragraphs.
The reference application exported the unchanged source to `native.pdf` (one page).
`tools/reviewed_font_reference.py reviewed-family` independently records its
glyph origins, baselines and source/PDF hashes. The reference application and browser pages were
visually inspected. No corpus text or artwork is included.

The font loader restores missing families with reviewed, unmodified OFL-1.1
assets. The passing browser control enforces all ten line strings, one-page
pagination, baselines within 0.2pt, Oswald glyph origins within 0.2pt,
on-demand same-origin requests, native editing, package preservation, edit,
undo and reopen. Unit coverage verifies complete-family registration,
variable face descriptors, deduplicated concurrent requests, failed italic
loads, native priority, unknown families and relative application URLs.

Open Sans glyph fidelity is explicitly incomplete: maximum horizontal errors
are 0.944pt regular, 1.058pt bold, 2.515pt italic and 1.279pt bold italic.
Its strict 0.35pt oracle remains an expected-failure browser test, separate
from availability and package checks. An unexpected pass requests review.
The reference application's embedded font name tables identify Open Sans 1.10; the reviewed assets
are 3.003. A private diagnostic using the four unmodified Apache-2.0 1.10
faces from google/fonts revision 90abd17b4f97671435798b6147b698aa9087612f
still shows maximum drift of 1.360pt, so version differences alone do not
explain the gap. No spacing correction or document-specific adjustment is
applied. The diagnostic assets are not shipped.

The 2026-09-25 default-kerning investigation isolates another difference in
this original control: it omits `rPrDefault`, so the reference application uses its application
threshold of 1pt. The importer previously resolved zero. The independent
`default-kerning` matrix now proves and covers that distinction; it is fixed
without changing this source or its native reference. The current Open Sans
assets still expose identical widths with Canvas kerning enabled and disabled
for the tested pairs. The variable regular asset's GPOS feature list contains
`mark` and `mkmk`, with no `kern` feature or legacy `kern` table. The private
1.10 regular asset has a legacy `kern` table, but the browser diagnostic still
does not apply its pairs. Thus enabling the correct imported threshold alone
does not resolve this fixture's font fidelity. The strict expected-failure
oracle remains. Recent full-line maxima differ from the historical values
above; those historical measurements are not current acceptance thresholds.

This feature follows font selection under ECMA-376 Part 1 §17.3.2.26 and
§17.8.3; it does not establish a new reference/spec divergence. The original
font declarations and untouched package parts are preserved.


### Full-fragment glyph measurement (2026-09-27)

The strict Open Sans oracle now reads full-fragment shaped character origins
instead of treating prefix caret stops as glyph origins. This test helper is
restricted to the fixture's non-ligated ASCII text. It verifies SVG shaping
advance against the actual canvas fragment within 0.02px before comparing
native positions; the existing 0.35pt native tolerance is unchanged. This is a
measurement correction, not a renderer fix or a pixel-equivalence claim.

In fresh private measurements, full-fragment
maxima are 2.699pt with bundled 3.003, 1.509pt with original 1.10, and 0.388pt
with the private legacy-to-GPOS experiment. The last remains outside the
strict threshold. Removing only the empty GPOS table leaves the 1.509pt gap.
Each original 1.10 face contains 18,694 legacy pairs; its subtable occupies
112,178 bytes but the 16-bit length declares 46,642. A private experiment that
splits these pairs into two valid-length subtables and removes empty GPOS
restores kerning, but also retains a 0.388pt maximum mismatch. None of these
font mutations is installed or shipped. Historical caret-origin figures
above should not be described as measurements of painted glyph origins.

Optimization note: both unchanged-main and updated broad fixture tests now
observe six font requests and fail the existing maximum-three-request guard.
The strict shaping test retains its expected failure. The request-count
assertion is not relaxed, and this investigation does not claim that the
broader fixture suite or its later editing steps passed. Investigate the
repeated font loads separately from rendering fidelity.

### Unmodified font-file isolation (2026-10-01)

Current main's generic font-file loader reaches the previous converted-font
experiment's geometry with unmodified private 1.10 or 1.101 files. All ten
line strings and one-page pagination remain; both releases have identical
measured origins and a 0.388161pt maximum Open Sans error. Bundled 3.003 still
measures 2.698708pt. Every full-fragment SVG/canvas advance check is below
0.000498px. No private conversion is needed for this diagnostic; no font bytes
are installed or shipped. The unchanged 0.35pt oracle remains expected to fail.

The embedded native programs' `head.fontRevision` is 1.101, despite the earlier
version-name description above. All 32 nonzero PDF widths per face agree with
rounded 1000-unit design widths. Subtracting their accumulated quantization
differences does not close the gap: the maximum remains 0.374143pt. That
hypothesis does not model all PDF text positioning and is not a reason to alter
the renderer or oracle. Corresponding editable source for the legacy release
and family-wide fallback version policy remain open. This bounded control does not certify a corpus source.
