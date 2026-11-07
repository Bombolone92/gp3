# Style identity recovery controls

Generate with `python tools/style_identity_recovery_fixture.py`. These controls
extend the project's independently authored paragraph-style recovery fixture.
They use original small PNGs and no corpus artwork, embedded font binaries or
third-party document engine. ZIP timestamps are deterministic.

`healthy.docx` contains custom document defaults, a heading style, conditional
table formatting, two pictures, a header, numbering, direct italic text and two
tables. References to the omitted styles remain in the control, so it measures
the stated local approximation rather than inventing replacement styles.

Nine variants add missing IDs, conflicting paragraph/character/default/table
identities, a cross-type duplicate, simultaneous errors, or companion table
styles. `companion.docx` tests that a unique stylesWithEffects declaration cannot
resurrect an ambiguous primary identity. `companion-only.docx` tests ambiguity in
the companion itself. No first/last declaration is selected.

Strict import continues to reject primary identities that it cannot safely edit;
the same identity check now applies to a companion part when it is consumed.
Read-only import creates a private style XML view with rejected declarations
removed. Document defaults and unrelated definitions survive, and table readers
use the same view. Source package bytes and references remain unchanged; original
download is available and edited export is blocked.

This is an explicit recovery approximation, not full support for anonymous styles
or a claim that the reference application repairs conflicting IDs this way. Style semantics are in
ECMA-376 Part 1 §17.7. All 42 XML views across ten packages pass XSD validation;
schema acceptance alone does not prove usable, unambiguous style identities.

Unit tests cover rich formatting, defaults, source preservation, strict rejection,
derived styles, alternate styles-part paths and clone isolation. Browser tests
compare all recovered canvas pixels and body/header text geometry with the healthy
control, then check localized messages and exact original download. The source
and exported corpus document are not redistributed.

The before/after comparison against `a251ab09` proves the old combined control
lost every named style; the candidate preserves healthy Heading and Accent
definitions and matches the complete healthy-control canvas. The healthy control
and original corpus #353 remain pixel-identical across the change. This does not
complete that corpus document's unsupported decorative page-border artwork.
