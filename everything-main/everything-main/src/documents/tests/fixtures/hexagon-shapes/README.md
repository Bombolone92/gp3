# DrawingML hexagon controls

`tools/hexagon_shape_fixture.py` creates original controls from this project's
original shape-defaults package. `public/fixtures/hexagon-shapes.docx` contains
eight shapes: defaults, zero/intermediate/near-maximum adjustments, negative
and over-maximum clamps, a changed vertical factor, and combined rotation/flips.
One control has portrait local geometry. Three contain Arial text to test the
preset text rectangle. There is no private corpus content or external artwork.

The reference application exported `native.pdf`. The source and PDF hashes,
4,515 native ink samples and three text origins are in `reference.json`,
recorded by `tools/hexagon_shape_reference.py`. The regenerated package's OPC
parts were checked byte-for-byte against the package used for the reference application export.

The four `adjustments-*.docx` files independently reproduce a reference import
restriction. Empty adjustments open; `adj` alone fails; the ordered `adj`, `vf`
pair opens; the same pair reversed fails. `adjustment-import.json` records
source hashes and native results. Reproduce using
`tools/record_hexagon_adjustment_import.ps1`. All four pass the OOXML schemas.
Our importer resolves named overrides over the standard default guides and
accepts all four. It preserves the original XML, so the reference application's rejection of the
partial/reversed source is not repaired on export.

Relevant standard: ECMA-376 Part 1 §§20.1.9.18, 20.1.9.11, 20.1.10.56 and its
supplied `presetShapeDefinitions.xml` hexagon definition. These files establish
reference-specific import restrictions; they do not make those restrictions part of
the OOXML geometry definition.
