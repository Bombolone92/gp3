# Preset line native reference

Original OPC/XML authored by `tools/canvas_line_fixture.py`, using only the
Python standard library and original fixture constants. No corpus artwork or
third-party rendering engine. The exact DOCX was opened in the reference application and exported to `native.pdf` without saving.

Eight cases cover direct diagonal lines; zero-height/zero-width grouped lines;
nested horizontal, vertical and diagonal lines under nonuniform scale; ink
outside the group frame; and explicit no outline despite a solid shape fill.
The reference application's PDF retains a 2pt pen width for both unscaled and stretched groups.

`tools/line_reference.py` extracts eight ink bounds and 48 cross-sections
at 288 dpi into `reference.json`, alongside the source SHA-256. Browser
checks compare geometry within 0.75pt, reject accidental red area fills, edit
and reopen, and verify every package entry after undo. Font rasterization is
not part of this geometry reference. See `docs/conformance.md` for supported
line forms and remaining guards.
