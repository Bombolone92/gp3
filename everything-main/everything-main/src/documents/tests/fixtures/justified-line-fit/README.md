# Justified line fitting against the native reference: unresolved rendering regression

`tools/justified_line_fit_fixture.py` authors original text in sixteen paired
paragraphs: Calibri/Arial at 11pt, 360/365/370/375pt writing widths, and left/both
alignment. No private template content is included. The reference application exported
`native.pdf` without saving the DOCX. `tools/reviewed_font_reference.py
justified-line-fit` records the PDF character origins and source/PDF hashes.
The fonts must be installed locally; their binaries are not redistributed.

The browser matches thirteen cases' line breaks. Three demonstrate a missing
feature: Calibri 370pt and Arial 370/375pt fit an additional word in the reference application when
justified, but not when left aligned. The reference application reduces inter-word spaces; interior
letter advances remain essentially unchanged (subject to PDF rounding).
For example, Arial's second line at 370pt has roughly 2.4pt spaces, versus
roughly 3.1pt natural spaces. The browser currently chooses natural-width line
breaks and can only expand spaces afterward.

ECMA-376 Part 1 §17.3.1.13 and §17.18.44 (printed pp224–225, 1397–1398)
specify `both` alignment and inter-word rather than inter-character adjustment.
They do not specify a compression threshold or line-fitting algorithm. This
is evidence of missing reference-compatible behavior, not a demonstrated normative
contradiction. No arbitrary font-size, kerning or document-specific adjustment
has been added.

The browser test checks the thirteen matching controls and package preservation
through editing, undo and reopening. Three separate expected-failure assertions
retain the unresolved reference line breaks; setup/import errors are not marked as
expected. Passing this suite does not establish rendering completion.

A separate private diagnostic using original repeated words at 11/20pt in
Calibri, Arial, Times New Roman and Courier New shows that contraction also
affects final-line fitting and varies with font. A universal contraction factor
is not yet established. The next implementation needs controls for that boundary,
mixed runs, monospace fonts, hard breaks and final lines before changing layout.

Validation: 33 existing justification unit tests pass. The browser preservation
case passes and all three known rendering assertions fail as expected. Source
and three browser exports pass 16 XML checks; production build/license checks
pass. Both reference/browser pages were visually inspected. Runtime code is unchanged.
