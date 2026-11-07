# Saved content control preview

Original fixtures from `tools/control_preview_fixture.py`, including an original
solid blue PNG. No external artwork or document engine is bundled. The reference
application exported both references on 2026-09-18 without saving the inputs.
The corrected fixtures pass the ECMA transitional schemas. Hashes identify the
exact source/reference files; both PDF pages rasterize identically at 96 DPI.

The locked fixture wraps a styled title, mixed-format inline text, a nested
control, a picture and a shaded/bordered table in persistent locked controls.
The other fixture has precisely the same saved contents without those wrappers.
The reference application and the browser each paint their two variants identically. The browser
comparison waits for image decoding and checks read-only input plus original
download retention. Unit tests verify the inherited style, direct formatting,
table structure, image dimensions and wrapper-local namespace bindings.

This proves preservation of supported saved contents, not complete control
semantics or pixel equality between the reference application and the browser. The browser's general
paragraph/table spacing differs from the reference application in this fixture. Updating XML bindings,
refreshing glossary placeholders, control adornments and persistent control
editing remain unimplemented. ECMA-376 Part 1 §§17.5.2.33–36 defines sdtContent;
no specification divergence was identified for this projection.
