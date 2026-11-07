# Script formatting on inline picture runs

`tools/script_picture_leading_fixture.py` writes original OOXML and an original
solid-red PNG. No external template, font binary or picture is bundled. The
36 pages combine Arial 12 pt, Trebuchet MS 11 pt and Garamond 12 pt; picture-only
and mixed text/picture lines; automatic spacing 259/240 and 360/240; and
baseline, superscript and subscript formatting. Compatibility mode is 15.
Picture dimensions are 36 × 72 pt. Paragraph-mark formatting is explicit.

The reference application opened this exact source. The capture tool reads native
paragraph page numbers and positions through `Range.Information`, plus native
inline dimensions. Each script triple has the same following-paragraph top.
This establishes that a picture run's reduced script display size must not
reduce the font allocation used for automatic line spacing.

ECMA-376 Part 1 §§17.3.2.42, 17.3.1.33 and 20.4.2.8 define script formatting
without changing stored run font size, automatic line multiples, and inline
drawing placement. They do not specify a numerical font metric algorithm for
this combination. The native observations refine that unspecified behavior;
they are not evidence of a new normative contradiction.

The reference deliberately distinguishes line tops from painted glyph origins.
The reference application's range coordinates are quantized to 0.75 pt. Following paragraphs have
exact 12 pt lines; the independently measured `exact-font-baseline` control
establishes their top + 9.6 pt baseline. Absolute browser comparison permits
0.8 pt for the quantized capture; script triples must agree within 0.000001 pt.
The exact-line mapping follows a previously documented reference/spec divergence.

The native document's in-memory `Saved` flag became false during pagination;
no save or source edit was performed. The source on disk matches deterministic
regeneration byte for byte. A pending native reference PDF-export worker was stopped after
native position capture. **There is no native PDF reference for these controls.**
The separate original eight-page pamphlet comparison uses an existing native
PDF and records more precise absolute glyph-origin improvements.

Regenerate with `python tools/script_picture_leading_fixture.py --output DIR`.
Open the resulting source in the reference application, run `tools/capture_script_picture_ranges.ps1
-Folder DIR`, and call `record(DIR)` in `tools/record_script_picture_leading.py`.
The recorder checks source/capture hashes, original package structure, source
properties, native dimensions and matched triples. The browser test checks all
36 painted baselines, edit/export preservation, exact undo and reopening.
Unit tests also cover compatibility mode 12 and spacing below/equal to one.
