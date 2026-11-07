# Table style font inheritance controls

The manually written generator `tools/canvas_table_style_font_defaults_fixture.py`
creates two files with document font defaults of 16pt and 12pt. Thirteen tables
vary absent/empty run properties, color, bold, font, shading, conditional run
groups, explicit size, and inheritance from an 18pt table style. Both were
opened with the reference application and exported without saving; the 12pt PDF lives in
the adjacent `table-style-font-defaults-12` folder. Manifests identify both source
files and their native reference PDFs.

The reference application keeps 12/16pt when no table size is declared and uses 18pt when explicitly
declared or inherited. Its 16pt PDF text operators report 15.96pt. The extraction
script joins same-baseline PDF text pieces and records observed sizes; unit
checks allow 0.1pt for that export quantization.

These controls prevent an unjustified blanket 10pt fallback while investigating
the separate conditional-table-styles fixture's 10pt/12pt discrepancy. They do
not explain or resolve that discrepancy. All four XML parts across the two
sources pass transitional OOXML schema validation.
