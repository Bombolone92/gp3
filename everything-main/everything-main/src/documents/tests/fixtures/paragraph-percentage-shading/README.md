# Percentage paragraph shading

`tools/paragraph_percentage_shading_fixture.py` manually authors two DOCX files
with 60 cases each. Both use explicit Arial 8pt text, exact line heights and the
same three-page content; `dark.docx` additionally has a dark page background.
The cases cover all 23 percentage values in ST_Shd, black/white and mixed-color
blends, automatic channels inside a dark cell, automatic solid shading, and nil
with and without an inherited paragraph-style fill. No corpus XML is copied.

The reference application exported `native.pdf` and `dark-native.pdf` using
`tools/export-reference.ps1`, which confirms FullName and repaginates.
`tools/record_paragraph_percentage_shading.py` records 120 independent native
color samples, each checked for uniformity over a 9x9 pixel neighborhood at
288 dpi. Source/PDF hashes are retained in `reference.json`.

Native findings:

- Percentage shading is a uniform sRGB blend, not visible stippled dots.
- `pct12`, `pct37`, `pct62`, and `pct87` mean 12.5%, 37.5%, 62.5%, and 87.5%.
- For each channel, the reference application adds the percentage-weighted foreground-minus-background
  delta to the background, rounding that signed delta to nearest with halfway
  values away from zero. Colored cases distinguish this from always rounding a
  final half-byte down: red 59 toward 209 at 5% becomes 67, while white toward
  black at 10% becomes 229.
- Automatic percentage foreground/background are black/white on both page
  colors and inside a dark cell. Automatic solid paragraph shading is black.
  These are distinct from the automatic text/run-background contrast rules.
- `nil` ignores the declaration. C36 exposes the dark cell; C37 retains the
  inherited `775533` paragraph-style fill.

Unit checks compare all native colors, verify retained percentage/nil XML on
text/style edits, explicit replacement with clear RGB, export/reopen and exact
undo. Browser checks compare the same native colors on every page before/after
typing and after reopening exports. All six native/browser page pairs were
visually inspected. Hatch patterns remain unsupported; these controls concern
paragraph shading, not patterned run or cell shading.
