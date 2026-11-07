# Cubic flattening generalization sweep

Original numerical controls, not corpus artwork. `cases.json` contains 96
deterministic curves (Python `random.Random(29092026)`, four pairs from uniform
[-2,2], multiplied by cyclic scales 1/16, 1, 16 and 256), nine coordinate-boundary
cases and eight constant cubics. The explicit JSON coordinates are authoritative.

`native.json` captures `System.Drawing.Drawing2D.GraphicsPath.Flatten(null, 0.25)`
after converting each input coordinate to single precision. The second capture,
`native-quantized.json`, first rounds those single-precision inputs upward to
1/16 unit. Both files bind the exact input hash. All 226 captures reproduced
exactly in a separate run. Only 91 of 113 raw captures equal their pre-quantized
counterparts. These are **native GDI+ API references, not reference-application DOCX references**;
the six separate `svg-cubic-coverage` DOCX controls establish the native reference comparison
for their own shapes only.

Reproduce with `tools/capture-cubic-flatten-sweep.ps1 -InputPath <cases.json>
-OutputPath <native.json>`; add `-QuantizeInput` for the second capture.

`python tools/probe_svg_cubic_flatten.py <output.json>` evaluates two original,
unreleased numerical models. Expected status is **1**, because both still fail:

| Model | Six native DOCX controls | Raw sweep | Pre-quantized sweep |
| --- | --- | --- | --- |
| Midpoint subdivision, maximum component second difference ≤0.25 | 6/6 | 61/113 | 78/113 |
| Adaptive endpoint finite differences, experimental precision 14 | 6/6 | 66/113 | 85/113 |

The midpoint model rounds input coordinates upward to 1/16 and output vertices
to the nearest 1/16. It also reproduces the previously captured private ticket
vertices, but fails generalization. The finite-difference candidate retains
integer arithmetic during step changes; its precision is an experiment, not
a normative rule or an implemented compatibility contract.

One useful counterexample is `seeded-27`: its pre-quantized final control point
is (422.8125, -300.625), but the captured final flattened point is (420.75,
-301.625). A mathematically exact endpoint-preserving subdivision cannot reproduce
that API result. The later [larger DOCX controls](../svg-cubic-coverage-large/README.md)
confirm the reference application's raster behavior for six selected cases, including this curve after
integer translation. The other sweep cases remain API-only. No renderer depends on
these captured vertices or either candidate algorithm.
