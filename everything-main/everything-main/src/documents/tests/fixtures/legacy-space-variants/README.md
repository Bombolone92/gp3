# Legacy kerning and nonbreaking spaces

`tools/legacy_space_variants_fixture.py` authors the 48 paragraphs directly as
original OPC/XML: four Rockwell faces, 12/18 pt, -0.5/0/+0.5 pt spacing, and
kerning disabled/enabled. Each includes an ordinary space and a nonbreaking
space. No font data is distributed. `native.pdf` was exported read-only from the
schema-valid source with the reference application; the recorder binds both
files' SHA-256 hashes and native text origins.

All 24 kerning-disabled origins match the viewer within 0.2 pt. The 24 enabled
origins remain unresolved. A held in-memory kern-to-GPOS conversion improved
every enabled case but left 0.45–0.98 pt origin errors and increased validation
time. It is not enabled in the renderer. The browser regression retains an
explicit expected failure for the unresolved enabled cases; it does not relax
the native geometry tolerance. See the September 29 space-pair evidence note.

OOXML: ECMA-376 Part 1 §§17.3.2.19 (`kern`), 17.3.2.35 (`spacing`), and
17.3.3.31 (`t`). This records observed reference behavior; it does not yet establish
a reference/spec divergence or prescribe a nonbreaking-space normalization rule.

September 30 follow-up: installed-font glyph maps and native PDF advances isolate
the missing space–W pair at NBSP. In a private measurement experiment, display-only
NBSP substitution plus the held GPOS converter brings all 48 origins within
0.074 pt. It also exposes a 1.799px caret inconsistency, and the earlier conversion
slowdown remains unresolved. The production expected failure remains valid; no
renderer change is included.
