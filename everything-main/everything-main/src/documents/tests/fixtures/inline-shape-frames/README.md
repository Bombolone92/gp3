# Compatibility-aware inline drawing frames

`tools/inline_shape_frames_fixture.py` authors original preset rectangles,
custom rectangles, groups and nondegenerate diagonal lines as OOXML. There
are nine rotations per kind: 0, 44, 45, 90, 135, 180, 225, 270 and 315 degrees.
Three four-page documents differ only in compatibility mode (12, 14 or 15).
Each drawing has a 72-by-36-point frame, zero effect extents and Arial 10-point
A/B markers. No corpus artwork or third-party media is included.

The reference application exported each exact source read-only. The recorder
measures the A/B ink gap and subtracts the corresponding zero-angle gap to
remove glyph side bearings, then restores the known 72-point zero-angle
advance. Source, PDF and case hashes bind the 108 observations. Mode 12 keeps
the original width at every angle. Modes 14 and 15 reserve 36 points at
45, 90, 225 and 270 degrees, and 72 points at the other tested angles. Groups,
custom shapes and nondegenerate lines follow the same rule.

Regeneration: run the generator, export each document with
`tools/export-reference.ps1`, then run `tools/record_inline_shape_frames.py`.
The source and exported documents are checked with `tools/check-docx-schema.py`.

ECMA-376 Part 1 §§20.1.7.5–6 describe scene transforms; §§20.4.2.6–8 describe
effect extents, object dimensions and inline layout. The version-specific
orientation bands are independently measured reference behavior,
not a claimed explicit contradiction of those clauses. The original drawing
XML and painted scene transform remain unchanged. Separate `frameRotation`
metadata reserves and centers the modern inline frame without rotating an
already-rotated scene bitmap again. Anchors and degenerate flat drawings keep
their existing dedicated behavior.

Unit and browser checks compare all 108 native advances within 0.1 point,
check unrotated paint dimensions and centered placement, and cover ordinary
editing, exact no-edit/undo package preservation and edited reopening. Browser
checks also require visible shape and antialiased line ink. They do not certify
every possible effect, text-box content or drawing configuration.
