# Application defaults and OpenType compatibility

Twelve original OOXML controls isolate prefix shaping during the #252 script
investigation. Each has 27 rows: Garamond, Arial and Times New Roman, regular,
bold and italic, with omitted/zero/1 pt direct kerning. The text is always
`START TEST END`, with only `TEST` superscripted. Fonts are requested from the
machine; no standalone font files or corpus content are added. Reference PDFs
contain the reference application's normal embedded font subsets.

`tools/script_kerning_defaults_fixture.py` constructs document/styles/settings
XML using the original script-size control's OPC skeleton. ZIP bytes are
deterministic. `tools/export-script-kerning-defaults.ps1` confirms each exact
path in the reference application, reads prefix Font.Kerning/Font.Ligatures, exports its
PDF, and closes the control without saving. It does not change application defaults.
`tools/record_script_kerning_defaults.py` verifies source/PDF hashes, one page,
81 text runs, run order, PDF font identities and untransformed coordinates
before writing `reference.json`.

The controls vary:

| Run defaults | Compatibility mode | OpenType switch |
| --- | --- | --- |
| Absent or present empty | 15 | omitted, disabled, enabled |
| Absent or present empty | 14, 12, omitted | omitted |

An absent `rPrDefault` produces native kerning 1 pt and ligature mode 3
(standard/contextual). A present empty category produces zero/none. Explicit
kerning still overrides either default. ECMA-376 Part 1 §17.7.5.5 permits
consumer defaults for an omitted category; §17.3.2.19 defines kerning thresholds.

**Reference/spec divergence:** the published [MS-DOCX §2.3.3](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/116847ff-9af6-45a7-a21f-0e0ff2eef41d)
documents an unconditionally disabled default for `enableOpenTypeFeatures`.
The reference application uses the enabled path when the flag is omitted in mode 15.
Modes 12, 14 and absent retain the disabled path. Explicit off wins in mode 15.
For absent defaults, Garamond's native prefix origin is identical with mode-15
omitted/on flags, and moves left by 0.60/1.32/0.72 pt for regular/bold/italic
when explicitly disabled. Arial and Times retain their active kerning pairs.
This agrees with the existing metadata-based legacy-only/OpenType policy;
it does not justify a family-specific adjustment or globally disabling kerning.

The browser regression checks the end of the prefix against native positions
within 0.2 pt across all 324 rows. It deliberately measures the script's advance
origin before its separate paint offset. The separate `script-horizontal-origin.spec.js` now requires all 108 full
horizontal origins to pass after removing the invented italic translation.
Vertical placement remains open; passing these tests is not full
superscript/subscript agreement. Unit controls cover
effective properties, editing, untouched settings/styles, exact no-edit/undo
parts and reopening. Older explicit-off and explicit-ligature controls remain
independent regressions.
