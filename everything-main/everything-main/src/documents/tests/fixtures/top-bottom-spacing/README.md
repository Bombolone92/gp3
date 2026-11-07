# Paragraph spacing across a wrapping rule

Generated from original OPC/XML and a locally authored PNG by
`tools/top_bottom_spacing_fixture.py`. Twelve pages vary the anchor paragraph
mark between 9.5 and 12 pt and the following paragraph's before-spacing between
0, 2, 6, 11, 18 and 30 pt. The paragraph-relative drawing is a 0.1 pt band at
14.4 pt; its anchor paragraph has 0.5 pt before-spacing.

`native.json` binds the source and a private native reference PDF exported on
2026-09-30. All 36 visible text baselines are measured from page top in points;
page indexes start at zero. Run `tools/check-top-bottom-flow.mjs URL spacing`
or the `top-bottom-flow.spec.js` browser test. The browser test additionally
checks editable open, no-edit package equality, unrelated-part preservation,
exact undo and edited-file reopening.

The reference application clears the band before applying the following paragraph's before-spacing,
including when that spacing would already put the text below the band. Merely
testing the final text rectangle loses about 3.1 pt with the 9.5 pt anchor.
The anchor's own before-spacing is excluded from its paragraph-relative drawing
origin. ECMA-376 Part 1 §§20.4.2.11–12, 20.4.2.20 and 17.3.1.33 describe the
positioning, wrapping and spacing semantics; these controls establish the
native interaction, without claiming a reference/spec contradiction.
