# Retained story controls

`tools/retained_story_controls_fixture.py` authors a two-page OOXML document
with nested block controls in a header and block/inline controls in a footer.
The controls retain locks, IDs, a document-part gallery, and tag-only red/italic
formatting. The footer contains a square-wrapped original green image and
complex PAGE/NUMPAGES fields with deliberately stale cached values of 99.
No corpus text or artwork is included.

The reference application exported `native.pdf`. Both pages were visually inspected. The
printed header remains black, and the footer displays Page 1 of 2 / Page 2 of 2
beside the image. `retained_story_controls_reference.py` extracts printed lines
and origins and records the source and PDF hashes. This follows ECMA-376 Part 1
§§17.5.2.13, 17.5.2.29, 17.5.2.31, 17.5.2.34 and 17.5.2.36; no reference divergence
is claimed.

Tests verify native body editing, live page fields after repagination, unchanged
story XML/relationships and unrelated parts, export/reopen and exact undo.
Malformed control envelopes and unsupported saved story content stay guarded.
Controls remain immutable in the story model; this does not implement direct
header/footer editing or refresh external XML bindings or glossary placeholders.
