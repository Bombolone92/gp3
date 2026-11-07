# Oversized body-line controls

These are original DOCX packages, written directly as OOXML by
`tools/oversized_body_lines_fixture.py` and
`tools/oversized_inline_height_fixture.py`. The two-color PNG artwork is generated
with Pillow. No user document content, font binaries or third-party artwork is
included.

The four `inline-*` cases isolate a drawing taller than the 720pt writing area:
740pt on a fresh page, after ordinary text, twice consecutively, and 820pt
extending beyond the physical page. The reference application preserves the full authored
extent, starts the drawing on a fresh page, clips ink at the physical page edge,
and places following text on the next page. The renderer's editing geometry must
stay on the visible page without rewriting the drawing dimensions.

The other six controls now verify editable oversized text and expanded line
spacing. Fresh, preceded, consecutive, wrapped and explicitly broken 650pt
Arial text retains its native page identity, horizontal origin and baseline.
Following text advances to the next page without an extra empty page. Expanded
automatic leading may exceed the physical page; selection rectangles are
clipped to that page while the authored line spacing remains unchanged.
`tests/browser/oversized-body-text.spec.js` checks all six native references,
visible editing bounds, insertion, package preservation, exact undo and reopening.
This does not establish every oversized body-line combination.
The independent mixed-baseline guard remains in force. A shifted small drawing
must not qualify solely because its shifted line metrics exceed page height.

Relevant standard clauses: ECMA-376 Part 1 §§20.4.2.7 (`extent`), 20.4.2.8
(`inline`), and 17.3.1.33 (`spacing`). The pagination/clipping observations refine
consumer layout behavior; no normative reference/specification contradiction is claimed.

To regenerate, run both generators from the repository, export each source with
`tools/export-reference.ps1`, then run `tools/record_oversized_body_lines.py`.
The recorder hashes sources/PDFs and records text baselines, image placement
matrices, and independently rasterized visible picture bounds at two pixels per
point. Unit/browser tests cover the four inline cases, preservation, undo,
editing, page clipping and the separate baseline-shift guard.
