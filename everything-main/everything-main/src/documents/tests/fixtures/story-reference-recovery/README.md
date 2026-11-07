# Header/footer reference recovery controls

`tools/story_reference_recovery_fixture.py` derives these controls from the
independently authored `story-block-recovery/healthy.docx` package. It changes
only reference/relationship declarations or deliberately removes a referenced
part. No document engine is used to generate the variations.

`healthy`, `blank-header`, and `blank-footer` are valid supported comparison
controls. The missing-part, external-header and duplicate-header variations
are deliberately broken or unsupported relationship inputs, not claimed as
conforming DOCX packages. Recovery must leave only the affected variant blank,
retain the other story and body structure, report the issue, and preserve the
original bytes. Strict import still rejects these inputs.

ECMA-376 Part 1 §§17.10.2, 17.10.5 define the footer/header references and
inheritance. Blanking a failed explicit replacement is a read-only recovery
policy; it must not revive a previous section's reference. Additional unit
controls cover inherited blanks, first/even variants, and propagation of
malformed XML errors. Browser comparisons use the valid control with the
corresponding reference omitted, not the reference application's repair of the broken package.
