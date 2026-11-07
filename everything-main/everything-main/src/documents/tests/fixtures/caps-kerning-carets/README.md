# All-caps kerning and source carets

`control.docx` is independently authored by `tools/caps_kerning_caret_fixture.py`,
without the application's serializer or corpus text. Its four Arial Black 19pt
lines cover lower-case source with caps, stored uppercase, disabled kerning,
and mixed-case source with caps. `cases.json` pins the deterministic package.

`native-carets.json` records repeated collapsed `Range.Information(5/6)`
observations of a visible, already-open, unchanged owned copy in the reference
application. The reference application's `Range.Text` returns the display capitals, while the original
package retains the authored case. The source SHA and Saved guards passed.
The screen positions have 0.75pt resolution; browser comparisons allow 0.4pt.
No font programs, outlines or proprietary assets are included.

The enabled lines share their caret positions; the disabled line is wider.
This is normal `w:caps`/`w:kern` support under ECMA-376 Part 1
§§17.3.2.5/17.3.2.19, not a newly claimed reference/specification divergence.
The old editor shaped capitals correctly but left interior carets at the
width of the preceding prefix, omitting following-pair adjustments.

The browser regression verifies every native caret, pointer hit testing,
selection edges, edits, unrelated-part retention, exact no-edit/undo export,
and edited reopening. The correction shares the existing isolated-character
width cache; small caps, uppercase expansions, transforms and mixed display
spans do not enter the ASCII pair path.
