# Original SVG fill and viewport references

`tools/canvas_svg_fill_fixture.py` generates the three source DOCX files in
`public/fixtures`. All artwork is original rectangles and a triangle; the
retained PNG fallback is deliberately magenta. Each source exercises full,
cropped, grouped and shape-fill placement. The reference application opened
each exact source read-only and exported the PDF without saving the DOCX.
`manifest.json` records source and PDF hashes and the first PDF form's bounds,
matrix and fill-alpha states. The PDFs are reference evidence, not a claim
that the current preview matches them.

The fill control's full 120 by 80 SVG has a 14.4 by 9.6 internal-unit
rectangle at (0.085025, 0.032975), inside a 14.518 by 9.7182 form. The form
matrix maps the larger bounds to the target picture. The resulting inset
was absent from the original browser preview. This reproduces the earlier
stroke controls' viewport difference using only filled geometry. The native
frame correction and independent size/coordinate controls are now documented
in `../svg-viewport-geometry/README.md`.

The opacity control has three rows: presentation `opacity`, inline-style
`opacity`, and `fill-opacity`. Each row uses 0, .001, .1, .3, .5, .75, .999,
and 1. The reference application omits the first two fills and exports the rest at 25/255, 76/255,
127/255, 191/255, 254/255 and 1 (rounded decimal notation in the PDF).
The fourth row adds group opacity, combined fill/object opacity, a stylesheet
class, and nested opacity. These composition cases are intentionally retained
for follow-up; do not infer their behavior from the top-level alpha list alone.

`svg-opacity-composition.docx` adds pairs (.9,.9), (.1,.9), (.5,.5), and
(.3,.9) as fill/object opacity, parent/child opacity, parent/fill opacity,
and a single combined opacity. The first and fourth columns are vector fills
with alpha bytes 206, 22, 63 and 68. The middle columns are raster images;
their internal color/alpha conversion differs and is not corrected here.
The final row adds translucent fill+stroke shapes (also rasterized by the reference application),
RGBA color alpha combined with object opacity (vector alpha 206/255), and
inherited fill opacity (vector alpha 127/255).

The preview now corrects solid, unstroked vector fills using combined alpha
before byte truncation. It leaves translucent ancestor groups, stroked shapes,
gradients and text on their existing paths. Viewport padding is corrected for the measured native reference-device profile;
residual RGB rasterization differences remain open. The raw PDFs permit checking these
limits without treating the browser's output as its own reference.

To refresh manifests after capturing each exact source in the reference application, run
`python tools/record_svg_fill_references.py <capture-directory>`.

All three files pass the playground open/edit/export/undo/reopen and package
preservation checks. Sources and edited exports pass 48 XML schema checks.
The new browser regression also checks decoded alpha bytes directly against
the reference application's values, verifies cascade handling and preserves the excluded paths.
