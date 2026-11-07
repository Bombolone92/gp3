# The reference application's nil-root SmartArt normalization

The paired original inputs differ only in the document-root GUID and its
references. Data-point storage is orange, purple, green; connection `srcOrd`
values specify green, purple, orange.

With the nil GUID (`{00000000-0000-0000-0000-000000000000}`), the reference application
replaces the root and renumbers child connections to point-list order. With a
non-nil GUID, the reference application preserves both the root and declared ordering. The native
saved DOCX files prove the ordinal changes; PDFs independently record the ink.
Both inputs pass the OOXML schema. This is an observed reference repair behavior,
not a general rule to disregard connection ordinals. Normal traversal now uses
`srcOrd`; the nil-root compatibility path retains storage order without rewriting
the source package. Ties retain point storage order.

The previous candidate incorrectly generalized point-list order and placed the
Planner's page-two accent arrow fourth rather than last. The paired-root control
isolated the cause, and corrected traversal restores the native order. No corpus
identifier or saved drawing geometry controls this behavior.

References: ECMA-376 Part 1 §§21.4.3.2 (`cxn`, including `srcOrd`), 21.4.3.5
(`pt`, including `modelId`), and the schema's permitted model identity forms.
These controls contain no corpus XML or third-party artwork. Unused diagram parts
in each input come from the project's original linear-layout fixture; the reference application drops
them when saving the single visible diagram.

Regeneration:

```powershell
python tools/diagram_order_normalization_fixture.py
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-order-normalization/control.docx" -OutputPdf "$PWD/tests/fixtures/diagram-order-normalization/native.pdf" -OutputDocx "$PWD/tests/fixtures/diagram-order-normalization/native.docx"
powershell -NoProfile -File tools/export-reference.ps1 -SourceFullPath "$PWD/tests/fixtures/diagram-order-normalization/control-nonzero.docx" -OutputPdf "$PWD/tests/fixtures/diagram-order-normalization/native-nonzero.pdf" -OutputDocx "$PWD/tests/fixtures/diagram-order-normalization/native-nonzero.docx"
python tools/record_diagram_order_normalization.py
```

Hashes bind both inputs, saved DOCX files and native PDFs. Tests resolve actual
package relationships, compare before/after ordinals, verify imported scene order
and check no-edit package preservation for both cases.
