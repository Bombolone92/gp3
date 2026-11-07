# Conditional table style reference

`public/fixtures/conditional-table-styles.docx` is handwritten OPC/XML generated
by `tools/canvas_conditional_table_fixture.py`. It uses no application serializer
or third-party document engine. The reference application opened it normally,
repaginated it, and exported `native.pdf` (15 pages) without saving the DOCX.

`tools/conditional_table_reference.py` extracts observed PDF text color,
font, size and baseline, and samples cell shading 65pt to the right of the text
origin and 4pt above its baseline. White direct text highlighting separates text
from the equal-colored cell shading. SHA-256 hashes are in `manifest.json`.

The fixture contains 374 labelled cells across these cases: all edge/corner
options, options disabled, omitted tblLook, zero tblLook, attribute overrides,
contradictory cnfStyle at row/cell/paragraph levels, bands of one and two,
horizontal bands alone, band-only style with edge options enabled, two header
rows, first-row-only formatting, a horizontally merged first cell, derived
conditional groups, and wholeTable.

## Observed reference rules

- Omitted tblLook selects first row and first column and disables vertical
  banding (04A0). Explicit flags override the hexadecimal mask.
- Omitted band sizes disable banding. Explicit sizes one and two select their
  respective bands. With both axes active, column bands override row bands.
- First/last columns precede first/last rows, followed by corner formatting.
  Both leading header rows receive firstRow and upper-corner formatting.
- Contradictory cnfStyle values do not force all cells into the last corner.
- An enabled edge option with no corresponding style declaration does not
  exclude that edge from banding or shift the first band.
- The derived style's firstRow rPr containing only bold replaces the parent's
  firstRow rPr/color group. Its absent tcPr still inherits the parent's fill.
- A wholeTable conditional declaration is ignored.

The omitted-look, band-size, precedence and wholeTable differences are documented
in MS-OI29500's notes to §§17.4.55, 17.7.6.5–7 and 17.18.89:

- [tblLook](https://officeprotocoldoc.z19.web.core.windows.net/files/MS-OI29500/%5BMS-OI29500%5D-170919.pdf)
- [row band size](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/77519f5b-08b3-4547-9f5d-0c4d87854220)
- [conditional precedence](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/2ac331d4-cf1e-4fa0-8bca-6da74411e284)
- [wholeTable](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/3359ff85-c423-4b9d-be78-d1cf96f79486)

## Coverage limits

`tests/table-style-regions.test.js` checks region selection and group inheritance
against the reference application's color/fill/bold results for every labelled cell, plus reselection
after row insertion/deletion. It does **not** assert canvas rendering, importing,
pagination, paragraph style precedence, border geometry, export or editor undo.
The production importer now integrates supported conditional paragraph/run and
cell properties. `canvas-conditional-table-styles.test.js` checks the complete
imported color/fill/bold matrix, structural changes, direct/nil shading, export,
reopen and undo. The browser counterpart checks every cell's painted text color
and fill and an edit/undo/reopen cycle. See the separate conditional-table-borders
reference for geometry checks.

The original native reference PDF unexpectedly normalizes these cells to 10pt, although
docDefaults declares 12pt and the app renders 12pt. This makes the app's text
origins about 1.9pt lower; their positions/font sizes are **not** passing native reference
comparisons in this fixture. Do not regenerate the reference to hide this.
Removing cell pPr/rPr and text highlighting in a diagnostic copy did not remove
the discrepancy. The separate table-style-font-defaults probes retain 12/16pt
and explicit/inherited 18pt in the reference application, so a blanket 10pt fallback is incorrect.
The precise trigger remains unresolved. The reviewed TF25409 agenda's matched
title/detail origins agree within 0.14pt after conditional-style integration.

The fixture's document.xml and styles.xml pass the transitional OOXML XSD.
Schema validity alone does not establish rendering fidelity.
