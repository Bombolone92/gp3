# Absolute bitmap scale and phase controls

`tools/raster_phase_fixture.py` manually builds the OOXML package without the
application importer/exporter. Its original 625×300 RGB artwork contains lines,
an ellipse, a diagonal and a solid rectangle; no corpus assets or font glyphs
are used. PNG and TIFF encode the same pixels. Two 576×420 pt pages each contain
five PNG/TIFF pairs. Widths are 72 and 111 CSS pixels; offsets exercise five
fractional phases. Page-relative no-wrap anchors isolate the image frame from
paragraph/table metrics. `cases.json` records declared dimensions and hashes.
Regenerating the fixture reproduces its bytes exactly in the checked environment.

The reference application opened an exact owned copy through the reference-application helper
in its visible window. Both pages and all pictures were inspected at 100% zoom.
Read-only `Pages.Item(n).EnhMetaFileBits` observations captured each page twice;
the repeat bytes match. The source hash and Saved-before/after guards remain
unchanged. No statistics, repagination, source-save or font-file calls are used.
`tools/record_raster_phase.py` records compressed bitmap hashes and explicit
image transforms from these captures. It rejects unsupported transforms and
encodings; it does not interpret font objects. Four native image objects all
decode to the fixture's original pixels. All 20 image draws are accounted for.

`native-reference.json` is numeric/hash-only evidence. Captured positions and
extents can round on the metafile's 4800×3500 logical grid. That grid does not
establish a universal native page-position rule. Native source rectangles begin
at (-0.5,-0.5), with interpolation mode 7 and pixel-offset mode 4. These settings
are not sufficient evidence for a browser half-pixel correction.

The browser regression binds to that native input evidence, checks all declared
anchor frames, paired painted pixels, no-edit/undo package identity, unrelated
part preservation through editing, and editable export/reopen. Every PNG/TIFF
pair paints identically at both sizes and all phases. Original and three
exported packages pass the transitional schema view. These checks establish
input, geometry and editing coverage, not exact native screen raster agreement.

`screen-comparison.json` records bounded errors against lossy native screenshots
using the visible paper borders as origins. Native Windows GDI+ replay of the
page metafiles does not consistently reduce error versus the browser. It is
therefore not an exact physical-screen oracle. Screenshots, metafiles and replay
pixels remain private; no screenshot-derived correction is shipped. Template
#68 remains partial, and no corpus totals change.

Isolated whole-page module routes also tested rounding the display origin,
rounding origin and size independently, and rounding the two far edges. The
unchanged route reproduces both current pages exactly, and all 20 observed
caller transforms are identity matrices. Independent origin/size rounding at
1× density reduces the bounded screen error in all 20 cases; far-edge rounding
has counterexamples. This is evidence for the next display-policy experiment,
not proof of a general rule: other artwork, ties, magnification/device density,
crop, rotation, reflection and clipping still need native controls. Logical
anchor coordinates and document bytes were unchanged throughout these probes.

The fixture exercises ECMA-376 Part 1 sections 20.4.2.3 (`anchor`), 20.4.2.10–11
(`positionH`, `positionV`), 20.4.2.15 (`wrapNone`), 20.1.8.13–14 (`blip`,
`blipFill`), 20.1.8.56 (`stretch`) and 20.2 (pictures). No new divergence in
OOXML interpretation is established. Image interpolation and pixel-offset
values follow the published
[MS-EMFPLUS property record definitions](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/5df4ef02-3895-41a3-aa0e-a8f4b8b31e4e)
and [interpolation enumeration](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emfplus/51312252-755a-4c8b-84bd-6ae73da1b5ea).


### Screen bitmap frames: independent native controls (2026-10-04)

An independently authored holdout uses different original RGB artwork, widths
63.4999/103.5001 CSS px and phases around half-pixel ties. Its source package is
created by `tools/raster_phase_fixture.py --holdout`, without the application
importer/exporter. The reference application opened an exact owned copy. All 80 numeric Shape extent
and offset fields match truncation to whole twips; raw extent rounding has
counterexamples. Saved/source guards and repeated page captures remain intact.
`holdout/object-properties.json` records that metadata separately from pixels.

The renderer now truncates the physical screen extent to whole twips and rounds
each device origin and extent independently. It applies only to uncropped,
axis-aligned bitmap painting with positive transforms, smoothing and source-over
composition. Logical frames, OOXML EMUs, hit testing, source pixels and print
painting remain unchanged. Rotations, reflections, crop and tiny extents retain
their established paths pending their own native controls. This is observed native
display interoperability, not an OOXML requirement to rewrite declared extents.
The applicable Part 1 clauses remain those listed above.

`native-bitmap-regions.png` contains 52 crops of the original fixture artwork only,
from native reference 100%/200% screenshots. It contains no corpus artwork, font glyphs
or application UI. The artwork generator is the corresponding original source;
`tools/raster_phase_atlas.py` reproduces the atlas from guarded private captures.
`display-reference.json` binds the source/screenshot/atlas hashes, page-border
origins, crop coordinates and bounded baseline/projected errors. Every region
improves, including the 12 magnified regions repeated at DPR2. Lossy JPEG capture
and screen color limitations mean these checks do not prove exact raster agreement.

Template #68's logo error falls from 16.187 to 5.703 grayscale MAE. Only the logo
pixels change; the document remains editable, with unchanged logical geometry,
no-edit/undo package identity and preserved unrelated parts through editing.
It remains partial. Nine exported packages pass schemas; 94 related unit checks,
22 distinct ordinary browser checks, license checks and the build pass. The
existing CMYK expected failure remains open. Print pixel hashes are unchanged
on the holdout and invoice. Context-separated timing was noisy and included a
slower invoice result; the paired same-context projection toggle measures
7.816 ms baseline versus 7.805 ms projected over 16 alternating batches each.
That bounded check shows no measurable slowdown, not a universal performance
guarantee.
