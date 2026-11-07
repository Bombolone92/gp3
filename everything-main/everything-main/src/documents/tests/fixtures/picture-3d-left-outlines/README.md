# Left-camera ellipse outline diagnostic

Ten original controls use a neutral gray PNG, 144 x 108 point ellipse,
perspectiveLeft camera, zero contour and unchanged three-point lighting. Each
extrusion depth (20 and 0 points) has absent, explicit noFill, 0.75, 2 and 8 point
outlines. `tools/picture_3d_left_outline_fixture.py` authors the package from our
original texture control, without corpus artwork or font programs.

The reference application captured ten page EMFs from the exact helper-opened scratch copy.
`native.json` binds the source and raw page hashes and records Saved before/after,
unchanged source, page geometry and measurements. The gzip files retain those
captures. `tools/record_picture_3d_left_outlines.py` independently rechecks the
lossless bitmap records at their native 600 dpi positions, using the page API's
612 x 792 points and GDI extent 5100 x 6600. It rejects transformed records.
The diagnostic does not derive coordinates by resizing an EMF's physical frame.

At outer thresholds 200, 240 and 250, browser bounds at four pixels per point
have maximum errors 0.29, 0.28 and 0.27 points. Absent/noFill native bounds agree
at both depths. This rejects an outline-dependent outer placement defect in
the matched left ellipse. These are four bounds, not a complete contour or
photographic fidelity certification.

At threshold 110, the unoutlined extruded ellipse differs by 4.45 points at
the leftmost dark-wall bound. Zero-depth controls have no pixels below that
threshold. This redirects investigation toward the extrusion's shading response;
it does not prove the lighting formula is wrong. A threshold crossing is not
the same as a 4.45-point geometry error. No runtime patch or fitted offset is
justified by these captures. Corpus card #10 remains partial.

The browser checks protect outer bounds and editable import, untouched package
parts, export, exact undo and fresh reopening. Color response remains unresolved.

## Exposed-wall color follow-up

`wall-interior.json` retains 1,512 fixed native pixel-center samples from the
unoutlined 20pt extrusion. The authored 0.48pt grid uses a 0.75pt projected
margin from neighboring surfaces and a 2pt depth margin. These are fixed
reference positions; tests do not discard samples based on their color error.
The recorder verifies every RGB against the retained page-1 bitmap.

Both the analytic shader and the browser page bitmap match these interiors
within two RGB levels, below the existing three-level native shading bound.
Near the face/silhouette boundary, analytic surface colors cannot be compared
directly with filtered raster pixels. This rejects changing the lighting formula
on the basis of the earlier threshold crossing. One gray field does not prove
all texture, color-transform, bevel or lighting combinations correct.
