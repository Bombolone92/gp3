# Supplementary-script input across fonts

Original XML from `tools/script_input_fonts_fixture.py`; 60 cases compare cs
and rtl source contexts in Arial, Times New Roman and Segoe UI Historic. Inputs
include Phoenician, Old South Arabian, Adlam, adjacent numbers/spaces, and mixed
Hebrew/Latin. No font files or corpus content are included. Record with
`tools/record-script-input.ps1 -Root tests/fixtures/script-input-fonts`.

The reference application uses ordinary input properties for Phoenician across all three fonts,
while Old South Arabian and Adlam receive rtl. The recording host's installed
Segoe UI Historic cmap was separately verified to contain both U+10900 and
U+10A60, so the Phoenician result was not inferred from a missing glyph. The
compatibility rule uses the Unicode script property, never the chosen font
name. It applies only to newly inserted run formatting: Phoenician keeps its
Unicode R class during document layout.

All 60 hash-bound native outcomes pass the flag comparison. This is observed
authoring behavior, not a claim that the standard requires this classification.
Native document.xml has the documented electronic ST_Hint omission for cs;
the source and application exports pass the pinned schema checks. Fallback
font and language changes in native XML are retained as evidence, not copied
into the application.
