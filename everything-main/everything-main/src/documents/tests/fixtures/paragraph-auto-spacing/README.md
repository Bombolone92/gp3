Diagnostic controls for the next automatic-spacing feature; not a support claim.
Generate with `python tools/paragraph_line_units_fixture.py --automatic`.
The reference application exported six pages without saving the source.
Record with `python tools/record_paragraph_line_units.py paragraph-auto-spacing`.
The true flags produce approximately 14pt gaps at 12pt and 24pt text; false
uses the one-line declaration (12pt). Compatibility settings and cell/list
boundary behavior still need independent controls before implementation.
