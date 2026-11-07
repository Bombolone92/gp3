# Compound shape outlines

All source XML is original. `tools/shape_compound_outlines_fixture.py` constructs
eight shapes from our own shape-defaults fixture: double, thick/thin, thin/thick
and triple, each solid and system-dashed. No user artwork or fonts are included.

The three control sets are:

| Fixture | Geometry | Reference samples |
| --- | --- | ---: |
| shape-compound-outlines | 200 × 90 pt rectangles | 4,727 |
| shape-compound-ellipses | 200 × 90 pt ellipses | 6,682 |
| shape-compound-ellipses-half | 100 × 45 pt ellipses | 2,915 |

Each folder contains an independently exported native reference PDF and a JSON
record of source/PDF SHA-256 hashes and raster colors. Exact source paths were
confirmed through the reference application's document object before export. Rectangular controls
were originally opened under the scratch filename compound-outline-probe.docx;
the committed source is the identical copied file. The half-size source and
reference were likewise copied without modification from the scratch control.

Generate ellipses with `--ellipse`; add `--half` for the smaller size. Record
reference pixels using `tools/record_compound_outlines.py` with the same flags.
Only locally flat PDF pixels are sampled, avoiding reference antialiasing edges.
The browser must match every selected RGB value exactly, before and after body
editing, undo, export and reopening. Source shape XML remains unchanged.

ECMA-376 Part 1 §20.1.10.15 names the compound types; §20.1.2.2.24 defines
outline properties and §20.1.8.48 defines preset dashes. The native references establish these band/gap proportions:
double 1:1:1, thick/thin 3:1:1, thin/thick 1:1:3, triple 1:1:2:1:1.
Gaps remain transparent to both shape fill and underlying page content.

The reference application starts a closed compound stroke at the last flattened contour vertex.
For rectangles this is the lower-left corner. For the two ellipse sizes, the
reference start is approximately (0.03, 46.16) and (0.07, 23.66) pt relative to
the frame. Adaptive cubic subdivision with 0.03 pt tolerance reproduces these
controls; this is an inference from the reference application's output, not a claim about its
internal implementation. Native Canvas ellipse dashing did not reproduce the
positions. Dash ends are capped independently at the contour seam.

These are native rendering details where the cited type definitions do not give
numeric band proportions or curve subdivision. No source-specific rule is used.
Open compound paths and explicit zero-width compound hairlines remain guarded.
