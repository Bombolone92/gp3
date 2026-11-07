# Native SVG group composition

These six original controls reuse the authored nested mask geometry as ordinary
translucent SVG groups, without a mask or identity filter. They cover overlapping
colors, nested isolation, fractional rectangle edges and zero-opacity paints.
The companion `svg-group-composition-chains` has six different opacity chains
of two to four levels, including .5, .75, .8, .125 and .999.

Generate with `python tools/svg_group_composition_fixture.py`, adding `--chains`
for the companion. Capture in an owned read-only reference-application document with
`tools/capture-svg-group-raster.ps1`; extract using `tools/record_svg_masks.py
CAPTURE.emf FIXTURE_NAME`. Manifests retain the reference build, source DOCX, native
metafile and PNG hashes. The generator contains no corpus artwork or markup.

The reference application truncates solid paint opacity to a byte, applies 8-by-4 coverage to the
premultiplied color and alpha separately, and stores straight RGBA between
paints. Source-over uses rounded byte arithmetic and a truncated 16-bit
reciprocal when returning to straight RGB. Group image opacity is rounded to
a byte before multiplying child alpha. Each translucent group remains isolated;
combining nested opacity declarations was an accidental fit to older controls,
not a general rule. A universal ties-to-even rule is also disproved by the
opacity-chain controls. Zero-opacity paints do not expand the raster bounds.

The production group renderer follows this arithmetic while retaining its
existing geometry sampling and supported-paint guards. Curves still use the
existing browser coverage path; this does not establish native curve
subdivision, general mask opacity classification or image resampling fidelity.
Original SVG bytes and source declarations are not changed.

`tests/browser/svg-group-composition.spec.js` compares bounds and every RGBA
channel of all twelve images after the same browser PNG decode. The two new
fixtures also participate in the ordinary no-edit/export/undo/reopen checks in
`svg-native-opacity.spec.js`. This is visible decoded-pixel agreement, not a
claim that PNG compression or hidden transparent RGB bytes are identical.
