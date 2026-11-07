# Synthetic-bold advance: native controls and rendering correction

Four independently authored DOCX controls retain 70 native reference one-line fit
thresholds. The modern control has 38 paragraphs with compatibility mode 15;
the eight-case thousand control omits settings. The 16-case ligature control
uses explicit none/standard ligatures with OpenType features enabled. The
eight weight cases reuse `../synthetic-bold/weights.docx`. All paragraphs explicitly set
zero kerning and use an empty run-default category, avoiding the reference application's implicit
application kerning default. No corpus text or font files are embedded.

The reference application was opened read-only, verified by FullName, and closed without
saving. For each paragraph, the exporter varies the right indent and uses
the reference application's line-count statistic to find the smallest whole-twip writing width
that fits one line. Bounds are checked. The PDF is exported after restoring
all indents. Source hashes, reference-reported font names/sizes and thresholds are
retained. The original captures used browser widths only to bracket the
search; the repeatable exporter now searches the full writing-width interval.
The decision at every boundary is the reference application's own line count.

For these controls, native synthetic bold adds one font design unit per
advancing glyph, including spaces. Franklin Gothic Book, Franklin Gothic
Demi and Calibri Light use 2048 units/em; Bebas Neue and Source Sans Pro Light
use 1000. Regular faces, Arial's real bold, and already-heavy Arial Black
need no synthetic advance. At the tested sizes, rounding the complete
advance upwards to a whole twip reproduces all 46 native thresholds when
this adjustment is included. Rounding each glyph to twips, or normalizing
every font to 1000 units, does not explain the earlier controls.

Combining accents distinguish glyph advance from code-point count: six
`a` + combining-acute sequences in Source Sans Pro Light 12pt bold require
1426 twips. Counting each combining mark separately predicts 1428. The
precomposed and decomposed Cafe-accent cases have identical native thresholds.
This is evidence for these strings, not a claim about every shaping cluster.

The renderer now derives a private FontFace in browser memory, adding one
unit to positive `hmtx` advances while preserving zero-advance marks, outlines,
GSUB/GPOS and kerning. It rebuilds checksums and removes stale DSIG/hdmx tables.
The browser continues to shape the complete string: explicit standard
ligatures stay enabled and all 70 native whole-twip fit thresholds pass.
The face is shared by measurement and painting. No font bytes are saved in
DOCX, written to disk or uploaded. Installed-face access requires the user's
browser permission; denied/unavailable access retains the prior behavior.
Collections, variable faces, selected bold faces and weights at least 700
are excluded from this derivation.

Native weight controls establish that stroke and advance are independent:
Segoe UI Semibold, Semilight and Dubai Medium receive the extra advance even
where the reference application uses fill-only ink. The subsequent metadata-weight correction now
also matches Dubai and Semilight ink while retaining all 70 advance thresholds.
The separate native ink test retains its original 5% tolerance.

A plain Canvas letter-spacing correction was rejected because it suppresses
optional ligatures. At Source Sans Pro Light 24pt, the explicit standard-
ligature bold sample needs 211.05pt in the reference application; the derived font measures
211.031845pt, which rounds up to that whole-twip boundary.

ECMA-376 Part 1 §17.3.2.1 (`b`) selects bold, and §17.3.2.26 (`rFonts`)
selects fonts; neither prescribes this synthetic per-glyph advance. This is
native reference compatibility evidence, not a demonstrated spec contradiction.

Regeneration:

1. Run `tools/synthetic_bold_advance_fixture.py` (byte-stable original XML).
2. Run `tools/export-synthetic-bold-advance.ps1 -Name modern` and again with
   `-Name thousand`, `-Name ligatures` and `-Name weights`, sequentially, on the reference Windows font environment.
3. Run `tools/record_synthetic_bold_advance.py` to bind the new artifacts.
4. Run the matching unit and browser tests. The synthetic-width oracles are
   required passing tests; no expected failure or widened tolerance is used.
