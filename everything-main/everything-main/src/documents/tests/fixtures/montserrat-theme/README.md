# Explicit, themed and inherited Montserrat Light

The original independent generator `tools/montserrat_theme_fixture.py` uses
repository-authored package/theme scaffolding and new text. It creates nine
12pt controls: explicit run fonts, run theme fonts, and document-default theme
fonts; each is regular, directly bold, or bold through a character style.
It does not contain corpus content or embedded fonts. Both generated files
reproduce byte-for-byte.

The reference application exported the one-page `native.pdf`. Run the recorder as:
`python tools/record_montserrat.py --fixture montserrat-theme --source control.docx`.
The reference binds all source/case/PDF hashes and measures baselines and 384dpi
ink. Browser tests use the existing 0.2pt origin and 5% ink limits, preserve
original font declarations, and exercise editing/export/undo/reopening.

These controls rule out the proposed theme/style bold-selection defect in
original corpus #120. The reference application uses the same Light font with an em/35 synthetic
stroke for explicit and themed bold. Actual browser paint calls on the original
use that stroke too; its bold Sincerely crop is within 1% of native ink at the
same 384dpi scale. A prior low-resolution visual inference was not sufficient
evidence of a font-selection bug. The original's unavailable Sagona title is
still a genuine limitation. No renderer behavior changed for this investigation.

Relevant declarations are ECMA-376 Part 1 17.3.2.26 (rFonts), 17.3.2.1 (b),
17.7.2 (style hierarchy) and 17.7.3 (toggle properties). No new reference/spec
divergence is established; native raster differences are not a normative rule.
