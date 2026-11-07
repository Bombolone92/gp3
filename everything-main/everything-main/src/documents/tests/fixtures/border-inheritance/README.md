# Equivalent border declarations and topology controls

Original OPC/XML authored by `tools/border_inheritance_fixture.py`. Each of two
one-page sources contains eight empty floating tables: 1×1, 2×1, 1×2 and 2×2,
repeated at Y=309 and Y=1748 twips. Total frame width/height, anchor positions,
font-free empty content, border widths/colors and page geometry are identical.
One source uses table defaults, including insideH/insideV; the other uses direct
cell borders. Removing only the respective border nodes produces identical XML.
No template content, font program or third-party artwork is included.

The reference application shows identical border cross-sections for every table and emits
the same ordered 142 PATCOPY rectangles in the two page metafiles. This rejects
border inheritance and connected topology as explanations for the previously
fitted isolated leading-origin rule. At 100%, even the **single-cell** first
table begins at Y=21; that formula predicts Y=20. The second row begins at
Y=116. These are display observations, not a normative reference/spec divergence.

The viewer already paints the two sources identically and preserves every
package part through no-edit export. That equivalence does not prove native
fidelity: minimum-width vertical origins and bottom edges remain incomplete.
The new native examples must be included with the previous phase, height,
filled, shared-owner and whole-crop checks before shipping a border correction.

The screenshots were inspected in the same reference application window, at 100% with
one page reported, before collecting read-only page metafile bits. Exact owned
scratch copies were closed without saving. Both source packages remain byte
identical. The second capture records savedBefore/savedAfter=true, empty text,
page geometry and zoom. Its raw Build value accidentally repeats Version;
the recorder validates that value and separately normalizes the build number.
The first metadata serialization failed because Get-FileHash could not open the
reference application's locked file. Its saved state was checked before collection, and the file
was checked after close; savedAfter is not claimed for that first capture.

The eight cropped PNGs per source retain real screenshot pixels. The first crop
can include editing caret/handles; measurements use cross-sections away from
them. Paper-outline segments independently establish the [272,202] origin.
This is threshold-128 border geometry at 100%, not full RGB or 200% equivalence.
Native source/crop/metafile hashes and exact runs are in reference.json.

Reproduce source packages, then record from the retained private captures:

```powershell
python tools/border_inheritance_fixture.py --output <directory>
python tools/record_border_inheritance.py <capture-directory> --output <directory>
npx vitest run tests/border-inheritance.test.js
npx playwright test tests/browser/border-inheritance.spec.js --config=.private-teacher-confirmation.config.mjs
```

The browser tests decode the native images independently and check all sixteen
cross-section pairs. Separate real-import checks enforce source equivalence,
one editable page, no runtime errors and exact no-edit export parts. No renderer
change, source-specific rule or corpus completion follows from this experiment.
