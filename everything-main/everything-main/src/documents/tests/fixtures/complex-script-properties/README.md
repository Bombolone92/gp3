# Dormant complex-script run properties

Original XML authored by `tools/complex_script_properties_fixture.py`, using
only the OPC skeleton of the original RTL fixture. No corpus content is copied.
`native.pdf` was exported by the reference application;
`tools/record_complex_script_properties_reference.py` records its native text,
baselines and fonts and binds the DOCX/PDF hashes.

Four Latin paragraphs contrast document defaults, paragraph inheritance,
character-style toggles and direct overrides of bCs/iCs/szCs. The reference application paints all
four in ordinary Arial 10pt despite different dormant complex-script settings.
These controls verify their inactivity on Latin text. They do not establish
active complex-script shaping or the reference application's glyph appearance for style toggles.

The unit regression covers resolved declarations, run splits, insertion, style
edits/removal, unrelated-part retention, reopen, invalid sizes and exact undo.
The browser regression compares the ordinary Latin layout with the reference application and edits
the original without losing its complex-script size. The separate RTL controls
remain the reference for the next implementation work; active RTL stays guarded.
