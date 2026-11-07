Source: `public/fixtures/automatic-line-baselines.docx`, authored independently
as OPC/XML by `tools/canvas_automatic_line_baselines_fixture.py`.

Twelve pages cover Century Schoolbook 30pt and Century Gothic 10pt, each at
120, 180, 240, 250, 360 and 480 units of automatic line spacing (240 = single).
Each page has a single-spaced lead paragraph, a two-line test paragraph and
a single-spaced following paragraph. Paragraph marks have explicit matching
fonts and sizes. The reference application opened the exact source and exported the
retained PDF and FlatOPC without saving the source. `manifest.json` records
source/capture SHA256 hashes; `positions.json` records PDF text origins in
points from the page's upper-left corner.

The PDF shows that automatic multiples above one keep the natural ascent,
adding extra advance below the baseline. Fractions below one scale the ascent
by the multiple. Both regimes scale line advance. The corrected native canvas
baselines differ by at most 0.13pt across these 48 reference positions. The
browser test uses a 0.2pt tolerance and checks UI spacing changes, download,
undo, exact package preservation and reopening.

ECMA-376 Part 1 §17.3.1.33 defines automatic spacing in 240ths of a line; it
does not specify this internal baseline distribution. These captures establish
the reference application's placement rather than a claimed contradiction with the standard.
Separate exploratory probes found remaining baseline differences for exact
and minimum spacing. Those rules are unchanged here and remain under review.

The reference-coordinate browser check requires the two original fonts and skips
when they are unavailable; fonts are not redistributed. Existing generic
spacing/style browser tests continue to run without those native fonts.
