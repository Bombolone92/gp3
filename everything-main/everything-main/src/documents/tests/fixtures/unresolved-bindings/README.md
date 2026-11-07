# Unresolved content-control bindings

`tools/generate-unresolved-bindings.py` authors the minimal package
`public/fixtures/unresolved-bindings.docx` directly from original XML. It contains
two rich controls and one plain control using `w15:dataBinding`, all with a zero
store ID. An actual related custom XML store contains one namespaced value. Two
paths request an absent child; the third requests a nonexistent second value.
The XML data uses a different prefix from the XPath prefix mapping deliberately.

`native.pdf` is native reference output from
`tools/export-reference.ps1`. All three controls retain their saved text.
`app-edited-native.pdf` is the same native exporter applied to the browser test's
`edited.docx`: replacing `ave` with `EDIT` inside the first persistent control
survives opening and rendering in the reference application. The other two controls remain unchanged.
Hashes, page counts and extracted text are in `reference.json`.

These references establish binding content behavior, not identical typography:
the deliberately minimal package has no styles or explicit font. The reference application and the
editor currently use different fallback typography for that omission. The browser
test separately verifies exact page restoration after undo within the editor.

The separate experimental writable-reference edit/save probe remains pending in
scratch; it is not evidence for native edit/save success. Native read-only opening
and PDF export of both the original and browser-edited files completed.

The source XML, generator, tests and text are original project work. Reference
PDFs were generated locally with the reference application. No third-party
template, font binary or document engine is redistributed here.
