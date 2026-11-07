Current status (2026-09-26): the supported angle-bevel painter is integrated.
The ten-page browser comparison now passes, including the stable surface grid;
permission-denied editing and font changes with undo are also tested. OpenType.js
2.0.0 is now an on-demand MIT application dependency. The prototype/groundwork
sections below describe earlier checkpoints. Remaining source and size-control
boundary differences are still open.

# Text bevel and extrusion reference

`control.docx` is authored by `tools/text_3d_fixture.py`, independently of corpus
artwork. It contains ten pages of Arial text: plain, empty properties, extrusion,
bevel, their combination with default/matte/flat material, contour, inherited
matte properties, and a direct empty declaration overriding that style. All
pages use the same 144pt bold `Ao`, red fill and following ordinary paragraph.
There is no explicit scene/camera. No fonts are redistributed.

The reference application exported `native.pdf`. `tools/record_text_3d.py` records
the source/PDF hashes, following-text origins and 240 native interior RGB
samples. Samples have a nearly constant 5×5 neighborhood at 288dpi and avoid
glyph antialiasing edges. The browser comparison allows four RGB values per
channel and 0.2pt baseline differences; this is not full-image equivalence.
`native-surface-grid.json` additionally retains all 7,223 stable points on the
same uniform three-point grid. The browser checks these as well as the original
240 spatially separated highlights. This prevents a few favorable highlight
samples from hiding wrong bevel joins or front-face boundaries.

Observed native behavior:

- Bevel-only and bevel plus extrusion have the same visible appearance with
  the omitted scene. Extrusion-only changes the face lighting but does not
  expose a side face. These observations do not cover rotated cameras.
- Explicit matte changes bevel shading relative to the omitted material.
- The inherited matte appearance matches its direct counterpart. A direct
  empty declaration clears that inherited appearance.
- Plain, empty, contour-only and the override case remain flat in this view.
  Flat material removes most visible shading; no general contour or flat
  material implementation is inferred from these samples.
- Following-text baselines agree across all ten pages.

Current application: ten editable pages, all effects painted as ordinary flat
text. The browser test first checks import, page count, layout and the five flat
comparison cases. It then records one explicit expected failure for the five
shading cases. This is an unresolved renderer defect, not passing support.
The separate main-only review passed no-edit ZIP equality, body insertion,
unrelated-part preservation, exact undo and edited export/reopen.

Specification: [MS-DOCX §2.6.3.23 CT_Props3D](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/80948ef4-142b-474f-8d61-d8bb279c4acb)
defines text bevel, extrusion, contour and material properties. There is no
established reference/spec divergence here. Standard schema checks use the MCE
fallback view and discard `w14`; they do **not** validate this extension's
lighting behavior or replace the native comparisons.

Regeneration, from the repository root:

```powershell
python tools/text_3d_fixture.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/text-3d/control.docx" -OutputPdf "$PWD/tests/fixtures/text-3d/native.pdf"
python tools/record_text_3d.py
```

Next implementation requirements: resolve direct/style/default properties,
derive text geometry without changing advances, render bevel/material shading,
preserve inherited empty overrides and original package data, and broaden native
controls for font sizes, scene rotation and lighting before claiming support.

## Scene-default controls and geometry prototype

`tools/text_3d_scene_fixture.py` creates `scene-control.docx`: eight pages,
crossing warmMatte/matte with omitted lighting and explicit threePt, balanced,
and twoPt rigs under an orthographic camera. `scene-native.pdf` is the reference export; `tools/record_text_3d_scenes.py` records hashes and glyph-region
pixels. For both materials the omitted scene is RGB-identical to explicit
orthographicFront/threePt/t over the recorded glyph region. Balanced and twoPt
are distinct. This establishes the omitted-scene choice for these controls,
not every camera or material.

The shared shader now implements matte's zero specular component, as specified
by MS-OI29500 §2.1.1334(b). Unit tests compare the native flat face and horizontal
bevel. This shader support is not yet connected to WordprocessingML text painting.

A private geometry prototype compared raster-distance, traced-polygon, and
font-vector approaches. The first rounds concave corners; the second inherits
false tiny corner segments from antialiased pixels. The vector-outline version
matches all 607 warmMatte and 646 matte stable grid samples within 3 and 2 RGB
values respectively. Both images were visually inspected. The native raster
softness, additional sizes/fonts/scripts, shaping and production integration
remain unchecked. Neither prototype nor font outlines are shipped.

The scratch vector probe uses OpenType.js 2.0.0's public font-path API under its
[MIT license](https://github.com/opentypejs/opentype.js/blob/master/LICENSE).
It reads the already installed Arial Bold face; no font binary is copied or
redistributed. It is not an application dependency and does not replace the
application's text shaping or measurement.

## Paired font-size and synthetic-bold controls

`tools/text_3d_font_sizes_fixture.py` creates `font-sizes.docx` and
`font-sizes-plain.docx` from the original matte control, crossing Arial/Franklin
Gothic Book, regular/bold, and 24/144pt. The package pairs differ only in the
text effect declarations. `font-sizes-native.pdf` and `font-sizes-plain-native.pdf`
are native reference exports; `tools/record_text_3d_font_sizes.py` records hashes,
thresholded red-ink bounds, following-text origins, and stable interior samples.
Fonts and extracted font contours are not distributed.

Small strokes retain the bevel. At 144pt the synthetic-bold 3D silhouette is
different from ordinary synthetic bold, so an em/35 centered stroke is not a
verified source for the 3D contour. Plain text painting must remain unchanged.
The paired-reference unit test protects this distinction and effect isolation;
it does not assert that the application renders these controls correctly.
See the font-size evidence file for the rejected prototype and measured errors.

To regenerate, run the fixture generator, export each DOCX with
`tools/export-reference.ps1`, then run the recorder. The PDF filenames
append `-word` to each source stem. XML validation uses the standard MCE fallback
and does not validate the w14 rendering semantics.

## Original contour expansion controls

`tools/record_text_bevel_geometry.py` generates temporary fonts with five
independently drawn glyphs at 1000 and 2048 units per em, registers them only
in its process, and records the unhinted synthetic-bold native outlines in
`outline-reference.json`. The font metadata headers come from bundled Source
Sans Pro (OFL-1.1), under a new family name; no generated font files are shipped.
Run this tool on Windows to regenerate the reference. It uses the documented
[GetGlyphOutlineW API](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getglyphoutlinew), not another document renderer.

`text-bevel-geometry.test.js` verifies bounded directional expansion, contour
winding, holes, and quadratic curves against those original shapes. It also
checks that implied midpoints are formed after expansion, all-off-curve loops,
closure, duplicate points and input validation. Point flags and quadratic
interpretation follow [OpenType glyf](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf) and
[TrueType fundamentals](https://learn.microsoft.com/en-us/typography/opentype/otspec170/ttch01).

Native diagonals retain a small quantization residual (tolerance 0.0001em).
The helper takes explicit expansion strengths and scale: these controls do not
prove a universal font-size selection rule or native equivalence for every font.
The app now calls the helper for supported text bevels. The text-shading browser
comparison passes the original controls; that does not establish equivalence
for every glyph. Ordinary synthetic-bold painting is unchanged.

## Synthetic-bold junction controls

`tools/text_3d_junctions_fixture.py` creates `junctions.docx` from the original
matte fixture, with six independent 325pt cases: Y and 4 in Arial regular,
Franklin Gothic Book regular, and Franklin Gothic Book synthetic bold.
`junctions-native.pdf` was exported by the reference application. No corpus
document or proprietary font outline is included in these controls.

Capture with `node tools/capture-text3d-junctions.mjs OUTPUT_DIRECTORY URL`,
then run `python tools/compare_text_3d_junctions.py OUTPUT_DIRECTORY`.
The browser capture uses Edge with local-font permission and device scale 3;
both raster comparisons use four pixels per point. The comparator excludes
nonuniform native edge samples and writes comparison data and paired crops.
This is a diagnostic, not a passing rendering regression test.

The baseline at commit `317f489f` passes all sampled points in the four regular
cases, but fails 91/9,897 samples for bold Y and 89/13,331 for bold 4, with
maximum channel errors 5 and 19. See
`tests/fixtures/measurements/text-bevel-junctions.json` for hashes and failing
coordinates. The baseline capture excludes the unrelated legacy-kerning WIP.
The fixture passes the standard MCE schema view; that does not validate w14
rendering semantics. These controls retain an unresolved rendering target;
they do not promote corpus template #365 to complete.

## Bevel smoothing across shallow corners

`tools/text_3d_bevel_smoothing_fixture.py --record` generates ten original fork
outlines and `bevel-smoothing.docx`, exports `bevel-smoothing-native.pdf` through
the reference application, and records the native samples in `bevel-smoothing-reference.json`.
Five controls bracket a 30-degree turn (28.81, 29.68, 30.006, 30.43, 31.17
degrees); five keep the turn constant and vary the adjoining edge length.
The reference application smooths the shallow junctions, and the gradient depends on edge length.
Area-weighted normals followed by interpolation of illumination match all
50 stem samples within one channel value. These are original unsynthesized
outlines, so the rule is not specific to a font or to synthetic bold.

The generator builds temporary fonts from original outlines and existing
OFL-1.1 Source Sans Pro metadata under the new family name Bevel Smoothing
Probe. It temporarily registers that font for the reference export, unregisters it
in `finally`, and deletes it. No font binary or proprietary outline is shipped.
The DOCX needs this generated font when refreshing its native reference; use
the generator's `--record` command rather than opening it without the font.
The recorder checks the ink dimensions to reject fallback-font exports.

The application uses the same geometric rule for supported text bevels.
`text-bevel-lighting.test.js` checks the original native geometry and colors;
`text-bevel-junctions.spec.js` checks the previously failing Franklin Gothic
Book Y samples and package preservation through edit/export/undo. The bold 4
still has an unresolved contour discrepancy. No normative smoothing rule is
asserted by this evidence: MS-DOCX CT_Props3D specifies the effect parameters,
but these controls establish the native interpolation behavior.
