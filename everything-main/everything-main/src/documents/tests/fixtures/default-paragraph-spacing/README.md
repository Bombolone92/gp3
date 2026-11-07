# Missing paragraph-default category

`tools/default_paragraph_spacing_fixture.py` generates original controls from
the original `header-drawings-footer-blank.docx` fixture. The eight cases cover
an omitted category, empty `pPrDefault`, empty `pPr`, explicit after/line values,
legacy compatibility, no styles part, and a default style with exact spacing.

The reference application opened each control. COM reports the final footer paragraph's
line rule and spacing and the Normal style's after-spacing. Saving a separate
copy in the reference application reveals the paragraph defaults the reference application materializes:

| Source | Native default spacing | Final paragraph |
| --- | --- | --- |
| Omitted `pPrDefault`, legacy mode, or no styles part | after=160, line=278, lineRule=auto | multiple 278/240 |
| Explicit empty category/property set | no spacing declarations | single |
| Explicit after=0 or line=240 defaults | no non-default spacing declarations on the reference save | single |
| Omitted category plus Normal style with exact 18pt spacing | after=160, line=278, lineRule=auto | exact 18pt; Normal retains 8pt after |

`reference.json` records the COM values, reference-materialized defaults, and
source/reference-save hashes. Generated source parts were compared with those the reference application
opened (expanded XML names for the no-styles control, where only prefix spelling
differs). The existing header-drawings native reference PDFs independently verify the footer
geometry, including its final empty paragraph.

ECMA-376 Part 1 §§17.7.5.1 and 17.7.5.3 explicitly make omitted document/default
categories application-defined. This is a reference-compatible consumer default,
not a claim that the standard mandates the numeric values. Explicit categories,
style declarations, and direct paragraph values retain their normal precedence.
New app documents already write explicit defaults and keep their existing values.

Tests check both the defaults and resolved footer values, unchanged no-edit/undo
packages, and serialization/reopening of an explicit line-spacing override.
