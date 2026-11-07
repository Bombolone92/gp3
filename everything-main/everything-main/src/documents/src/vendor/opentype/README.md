# OpenType.js 2.0.0 with hinting corrections

Source: the locked MIT-licensed `opentype.js@2.0.0` npm distribution,
`dist/opentype.mjs`. Upstream: https://github.com/opentypejs/opentype.js.
The original copyright and full MIT license are retained in `LICENSE`.
`public/licenses/opentype-MIT.txt` also carries the notice into production output.
This is a font parser/rasterizer, not a document engine. No fonts are included.

Regenerate with `node tools/generate-opentype-vendor.mjs`; verify with the same
command plus `--check`. Generation requires the exact reviewed upstream SHA-256
and applies only these corrections:

- MDAP[0] touches its point without attempting a movement.
- SDPVTL sets the current projection from current coordinates and the dual
  projection from original coordinates.
- Horizontal advance phantoms retain their original fractional coordinate
  separately from their grid-fitted current coordinate.

Original regression programs are in `tests/opentype-hinting-prerequisite.test.js`.
Investigation and limits are recorded in
`docs/evidence/text-hinting-prerequisite-2026-09-27.md`. This copy does not imply
complete TrueType interpreter conformance. Review upstream changes before
updating; do not apply these replacements to an unreviewed version.
