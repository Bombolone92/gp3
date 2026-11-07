# Direct-property recovery controls

Original mixed-content OOXML packages generated with Python's standard library
by `tools/direct_property_recovery_fixture.py`, using the original image-recovery
fixture builder. No external document engine is used.

The healthy control places text, an inline picture and more text inside a single
formatted run, in body content, a table cell and a header. Supported direct
properties include bold, color, font size, paragraph indentation, spacing and
paragraph-mark size. A second body picture, heading and numbered paragraph
provide unrelated content to preserve.

- `run.docx` adds unsupported patterned shading to those run properties.
- `paragraph.docx` adds diagonal-cross shading to their paragraph properties.
- `mark.docx` adds patterned shading to their paragraph-mark properties.
- `combined.docx` combines all three; `healthy.docx` omits only these declarations.

All five fixtures pass the official transitional schemas. Unit checks verify
that the actual pictures, surrounding text and supported formatting survive in
all three stories/locations, strict import still rejects the unsupported
properties, and read-only packages retain their source parts. Browser checks
compare full canvas pixels and body line geometry against the healthy control,
and verify the original download through the UI.

Relevant semantics: ECMA-376 Part 1 sections 17.3.1 (paragraph properties),
17.3.2 (run properties) and 17.3.3 (run content). This is local preview recovery;
the shading remains omitted and reported. No reference rendering equivalence is claimed
for omitted features. Unsupported inline structure, effective-format errors,
field-state failures and unisolated property interactions retain existing
fallback boundaries.
