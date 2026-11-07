# Cached-chart metadata and text controls

`tools/chart_metadata_fixture.py` authors chart XML and a minimal embedded XLSX
using the project's original chart package shell. The reference application opened each
source read-only and exported the PDF without saving the DOCX. No corpus content
is included. `record_stacked_charts.py chart-metadata` records native vector
geometry/colors, tick strings and hashes; `record_chart_metadata.py` records
native text families, emphasis and point sizes independently of the renderer.

- `chart-metadata-basic`: direct style 3 with explicitly supplied appearance,
  date1904, disabled rounded corners/title/data labels, complete finite caches,
  blank/NA display metadata, series IDs and an internal workbook with refresh off.
- `chart-metadata-auto`: MCE fallback to style 3 and the reference application's -60000000 label
  rotation sentinel. Its short labels remain horizontal in the reference application.
- `chart-text-inherited`: 14-point bold Arial chart defaults inherited by the
  value axis, with a 9-point minor-theme category-axis override.
- `chart-text-italic`: 12-point italic Arial axis labels and explicit blue ink.
- `chart-metadata-order`: intentionally puts showDLblsOverMax after extLst.
  The reference application opens/renders it, but the official XSD rejects that order. This negative
  source belongs here, outside the public valid-fixture collection. Its original
  XML is preserved; editable import is not a claim of source schema validity.

The theme's minor Latin family is Cambria in these original controls. The reference application
exports the requested 14-point text at 14.04 points; text assertions allow the
measured 0.05-point PDF quantization boundary. Normalized bars/ticks use the
existing strict chart reference checks. Chart-frame margins, automatic label
layout and the previously recorded one-level luminance-color residual remain
open; these controls do not establish full chart-layout equivalence with the native reference.

Related normative material: ECMA-376 Part 1 §§21.2.2.38 date1904, 21.2.2.42
dispBlanksAs, 21.2.2.49 dLbls, 21.2.2.63 externalData, 21.2.2.64 extLst,
21.2.2.180 showDLblsOverMax, 21.2.2.197 spPr, 21.2.2.202 style, 21.2.2.216
txPr; DrawingML text body/run properties in §20.1; Part 3 MCE branch selection.
Extension metadata follows [CT_DataDisplayOptions16](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/532c066f-fb03-42d5-9b4c-043a22279986),
the [2014 chart schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/40b8f1fc-b266-4f1f-90ec-d8ae7bafb140),
and [CT_StyleEntry](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/502b63f6-d2ff-47f9-a466-73af2d4cc03e).
