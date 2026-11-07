# Page-setting recovery controls

Original packages generated with Python's standard library by
`tools/page_setting_recovery_fixture.py`, using the independent image-recovery
builder. Each document has two different page sizes/margin sets, styled text,
a table, two images, a numbered item, and a header.

Variants add mirrored margins, ANSI kerning compatibility, three legacy spacing
flags, RTL gutter, vertical page flow, and their combination. `inactive.docx`
uses explicit false values. Strict import rejects active unsupported behavior;
read-only recovery must retain every otherwise-supported section setting and
original package part. Previously these flags reset the section to default
paper size and margins, and only the first omission was reported.

Sources: ECMA-376 Part 1 §§17.6.16, 17.6.20, 17.15.1.57; Part 4 §14.8.3.
The comparison control omits unsupported behavior. Matching its geometry and
pixels proves supported-layout retention, not native agreement for the omitted
features. Invalid dimensions and incompatible setting combinations retain
existing validation and may still require broader fallback.
