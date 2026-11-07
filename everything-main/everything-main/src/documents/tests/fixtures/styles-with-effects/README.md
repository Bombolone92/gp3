# Companion table style controls

The generator `tools/styles_with_effects_fixture.py` constructs two original
DOCX packages from repository-authored inline-picture art and package scaffolding.
No corpus document XML or application layout output supplies the reference.
`tools/record_styles_with_effects.py` records native reference PDF image
frames and text font/size runs, binding each source/PDF with SHA-256.

Each page has six tables with three pictures per table:

- A custom table style defined only in `stylesWithEffects.xml` (18pt indent).
- A conflicting style in both parts (36pt main, 18pt companion).
- An empty main definition with a nonempty companion definition of the same ID.
- A main definition based on a style available only in the companion.
- A companion definition based on a conflicting ID defined in both parts.
- No explicit table style, with the default defined only in the companion.

The native leading picture X values are 90, 108, 78, 78, 90 and 90pt. Thus a
main definition wins as a whole, inheritance stays within its selected part,
and the companion can supply an explicit or default table geometry style.

Paragraph and character styles present only in the companion do not apply to
the opening text. The main conflicting paragraph style does. `runs.docx` adds
text inside each cell and a bold green run declaration to the companion table
style: The reference application still paints regular black text. The app must not merge the two
collections into a single paragraph/run style graph.

The browser tests compare all 36 native picture frames, then edit, export,
reopen and undo while preserving both original style parts. The five existing
rotated-picture controls separately retain their original native coordinates;
they now pass without a six-point correction or expected-failure marker.

MS-DOCX §2.1.1 defines the companion part as a copy of Style Definitions;
ECMA-376 Part 1 §11.3.12 and §17.7 describe style definitions and inheritance.
The selective lookup behavior above is established by native controls, not an
explicit precedence rule in that extension description. No standards violation
is inferred from conflicting copies alone. Broader extension behavior remains
in scope. In particular, a scratch native probe changing the companion built-in
Normal Table indent to 18pt still used zero; that built-in normalization needs
further independent controls before extending the rule to it.
