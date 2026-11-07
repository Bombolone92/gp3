# Paragraph-style recovery controls

Original OOXML packages generated with Python's standard library by
`tools/style_paragraph_recovery_fixture.py`, using the original image-recovery
fixture builder for surrounding content.

`healthy.docx` defines custom paragraph defaults, a heading style and a
conditional first-row table style. They retain spacing and indentation; the
table region also specifies right alignment. The document contains two images,
a table, a numbered paragraph, colored text and a header.

`defaults.docx`, `named.docx` and `conditional.docx` add unsupported diagonal-cross
paragraph shading in the corresponding style context; `combined.docx` adds all
three. The healthy control omits only those declarations. All five packages
pass the official transitional schemas. Schema validity is not rendering equivalence.

Unit checks compare recovered styles with the control and verify source-byte
preservation, strict rejection and read-only recovery. Additional in-memory
cases check duplicate property groups, an inherited list reference alongside
rejected shading, and an unsupported revision in a numbering reference.
The deliberately duplicated shading declarations are malformed; no schema
conformance is claimed for that mutation.

Browser comparisons check complete canvas pixels and body line geometry for
each variant, and exact original download bytes for the combined variant.
Relevant ECMA-376 Part 1 semantics are sections 17.7 (styles), 17.7.5 (defaults),
17.7.6 (table styles), 17.3.1.31 (paragraph shading) and 17.3.1.19 (numbering
references). The omitted shading and revision semantics remain unsupported.
This is local preview recovery, not a claim of rendering equivalence with the reference application.
