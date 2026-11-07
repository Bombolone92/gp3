# Independent nested-table clipping and header probes

These DOCX packages were authored directly as OPC/XML by the Python scripts in
`tools/nested-table-probes`. They contain only test text and simple tables; no
third-party document engine or user document is used. `manifest.json` records
SHA-256 hashes of the exact captured inputs and reference JSON files.

To regenerate into a separate directory, run `nested-table-fixture.py paging
<output-directory>`, then `nested-clipping-fixtures.py <output-directory>`,
`nested-header-fixtures.py <output-directory>`, and
`nested-modern-header-fixture.py <output-directory>` in that order. The scripts
need Python and, for the header probes, lxml. Compare ZIP part contents: the older
paging generator has variable ZIP timestamps. All eleven source package part
sets were reproduced and compared with these captured files.

The reference measurements came from the reference application.
`nested-clipping-native-ink.json` records source and PDF hashes plus colored-pixel
bounds in points. `nested-header-reference.json` records source hashes,
compatibility modes, retained header flags, pages, labels and paragraph baselines.
`nested-header-native-ink.json` records the green nested-cell bounds on the two
pages of the header-container probe. Original native reference PDF, FlatOPC and capture metadata for these probes are packaged
in `native-clipping-headers`. Older page-border comparisons retain their measured
reference JSON; they do not claim a complete pixel comparison.

The header-inner probe omits settings (the reference application serializes compatibility mode 12);
header-inner-15 explicitly selects mode 15. Both preserve the nested header flag
but the reference application does not repeat that row. Outer headers still repeat, including nested
content. This differs from the unqualified leading-header repetition wording in
ECMA-376 Part 1 section 17.4.49. Exact-row clipping follows section 17.4.80.

The browser tests compare painted vertical bounds within one point, and the
unit header tests compare mapped paragraph baselines within a quarter point
using a common synthetic font baseline offset. These checks do not establish
complete pixel agreement. PDF text extraction alone is not visibility evidence:
the reference application retains text below a clipping boundary in the PDF text stream.

The clipping/header pixel tests render at device scale 3. At scale 1, a 1pt
horizontal border can occupy two partially covered pixel rows and contribute
no exact-color pixel at its true bottom edge. This caused the corrected corner
joins to appear 1.25pt short under the color classifier even though the layout
and painted stroke coordinates were correct. The original `inner-exact` PDF
has green ink down to about 128.06pt; scale 3 measures the app at 128pt, matching
the existing 128pt reference. The tolerance and reference values are unchanged.
A diagnostic suppression of the bottom border measures 127pt and still fails
the unchanged strict less-than-one-point assertion. All six clipping source/PDF
hash pairs and four header source hashes were reverified during this diagnosis.

The four width probes extend the evidence to parent-relative 50% and 100%
widths in compatibility modes 12 and 15. Run `nested-width-fixtures.py`,
`nested-modern-width-fixture.py`, then `nested-modern-width-full-fixture.py`,
passing an output directory containing the regenerated clipping source.
Their raw native reference PDF, FlatOPC and capture metadata are under `native-width`.
Reference JSON includes their hashes. All four regenerated archives compare
byte-for-byte with the captured sources. The initial mode-15 alignment failure is now covered by the horizontal probes
below; width-only unit checks alone do not prove full alignment.


`nested-horizontal-reference.json` records twenty independent probes and
hashes of their source packages and native reference PDF/FlatOPC captures in `native-horizontal`.
After regenerating the four width sources, run `nested-width-border-fixtures.py`,
`nested-alignment-fixtures.py`, `nested-alignment-extra-fixtures.py`, and
`legacy-percent-width-fixtures.py` in that order, passing the same output directory.
All twenty generated archives match the captured sources byte for byte.
`legacy-autofit-native-widths.json` separately records the first-row cell widths of
`public/fixtures/autofit-tables.docx` in the reference application mode 14; its raw PDF/FlatOPC are also
in `native-horizontal`. This reference supports the corrected total-width assertion,
not exact per-column glyph-metric equivalence.


`nested-autofit-border-reference.json` and `native-autofit-border` cover three
parent AutoFit probes, including a three-level table. Regenerate them with
`nested-autofit-border-fixtures.py` after the alignment generators. All three
archives reproduce byte-for-byte. Tests compare their measured borders with
the reference application and verify that editing and export preserve their sizing properties.
