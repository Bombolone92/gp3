# Saved invisible fill controls

`tools/hidden_fill_fixture.py` authors eight controls from this project's own
shape-defaults package. No corpus artwork is used. The controls pair visible
and invisible shapes with/without a saved red fill; additional visible shapes
retain saved gradient, pattern, picture and group fills. None of the saved
fills contributes visible ink. Dormant no-fill is covered by unit/schema checks.

The reference application exported `native.pdf` without saving the source.
`tools/record_shape_defaults_reference.py --hidden-fill` records the native reference samples,
glyph positions and source/PDF hashes. Browser tests compare the appearance
samples and check retained XML through editing, reopening and exact undo.
Unit checks also cover grouped shapes/pictures, saved-outline/shadow coexistence,
malformed extension containers, unchanged scenes and unrelated package parts.

[MS-ODRAWXML §2.3.1.5](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/51d55b23-c9a5-483a-b9eb-a0dd11d46ab5)
defines this as inactive stored fill information, ignored with a visible fill.
No reference/spec divergence was observed. The conformance tool validates each saved
subtree against the published, already hash-pinned `hiddenFill` schema declaration and
the ECMA `CT_FillProperties` type. Standards schemas remain in temporary storage;
no runtime library or third-party implementation was added.
