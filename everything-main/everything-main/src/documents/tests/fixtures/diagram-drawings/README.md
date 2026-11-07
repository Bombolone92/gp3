# Saved diagram drawing preview controls

`tools/diagram_drawing_fixture.py` derives these three independently authored
controls from the project's original diagram-layout probe. Their data/layout
and manually authored saved geometry agree: rectangle, ellipse and chevron,
each 200 by 100 points at page coordinates (36, 90). No corpus artwork is used.
Both model and saved colors include zero hue/saturation offsets.

The native reference PDF was exported using `tools/export-reference.ps1`, which
initializes every main-story SmartArt before export. All three native/app page
pairs were inspected. `tools/diagram_drawing_reference.py` records 3,308 stable
native samples, excluding antialiased edges. Browser tolerance is three RGB
levels. Hashes bind the test to the exact source and native reference.

The app renders saved drawings only as a read-only approximation. Tests verify
the editing guard, original ZIP-part download preservation and read-only reopen.
Strict import still rejects diagram layout recalculation. Visible DrawingML
text, decorated whitespace, bullets, picture fills and unknown saved-drawing
children remain guarded rather than silently omitted from a rendered diagram.

The first inline version exposed differing default fonts in the label paragraphs
(reference Times New Roman, app Noto Sans), which displaced the following inline
diagram. Page-relative controls isolate the saved drawing feature and exercise
the positioning used by source 169. The default-font discrepancy remains open;
these controls do not certify paragraph typography or full SmartArt support.

References: ECMA-376 Part 1 section 21.4 (diagram relationships/data/layout),
20.1.2.3.16 (hueOff), 20.1.2.3.28 (satOff), and MS-ODRAWXML section 2.10
(diagram drawing groups, shapes and dataModelExt). Zero offsets are validated
identities; nonzero hue/saturation offsets remain unsupported.
