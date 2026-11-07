# Primitive range holdouts

`tools/svg_cubic_range_holdouts.py OUTPUT_DIRECTORY` creates 612 authored
whole/half curves across six shape families and 360 independently seeded
controls. Heights bracket the observed 1,023-unit control-box span boundary;
phases include integer, half-unit and 65,536-unit translations. The seeded
normalization targets one axis; the other axis can have a larger actual span.
All classification uses the actual quantized two-dimensional control span.

The files here are compressed, hash-bound **native API** observations. They are
not reference-application DOCX raster references or a rendering lookup. All coordinates and
generators are original, with no corpus artwork or font program. Licensing
follows the repository.

For each generated input, capture twice with
`tools/capture-cubic-flatten-sweep.ps1 -InputPath INPUT -OutputPath OUTPUT
-QuantizeInput`. `svg_cubic_range_holdouts.record` checks exact source bytes,
case ordering, input hashes, tolerance, quantization and repeated parsed data,
then stores deterministic compressed references. The diagnostic reader also
regenerates and verifies both inputs before evaluating a model.

`tools/probe_svg_cubic_range_rule.py OUTPUT_JSON` evaluates a generic range
hypothesis and separate joint-halving arithmetic hypotheses. It never changes
or selects production behavior. `tools/test_svg_cubic_range_rule.py` checks
all 972 native vertex counts, preservation of existing exact controls, legacy
diagnostic defaults and invalid-option rejection. Remaining coordinate gaps
mean this model is incomplete despite its correct vertex counts.
