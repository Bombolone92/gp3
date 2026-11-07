# DrawingML color conversion boundaries

96 independently authored swatches use eight additional RGB colors with
luminance offsets/modulation, saturation modulation, shade/tint and ordered
two-/three-operation sequences. The near-black, near-white and nearly neutral
bases distinguish conversion-stage precision from arbitrary final byte rounding.

Generate with `tools/drawing_luminance_precision_fixture.py --sequence-probes
--output-dir tests/fixtures/drawing-color-sequences`, export through the reference
application, then record with `tools/record_drawing_luminance_precision.py
tests/fixtures/drawing-color-sequences`. The source reuses only this repository's
original shape/theme scaffolding; no corpus XML or assets are included.

The reference application produced `native.pdf`. `reference.json` binds source/PDF hashes
and records nine agreeing interior samples per swatch. Input and output
quantization to nearest 1/100000 linear-RGB units matches 96/96 colors.
Quantizing before every transform fails case 7: it produces 112333 instead of
native 112233. Omitting input quantization fails cases 3 and 42. These are
independent native observations, not expected values derived from the engine.

The source passes supported schemas. Unit/browser tests verify all swatches,
literal byte preservation, source/PDF provenance and editable package retention.
