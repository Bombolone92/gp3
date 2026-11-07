# Web-hidden text in paginated view

`tools/web_hidden_fixture.py` manually authors this original one-page DOCX.
It uses Arial 12pt and exact 16pt lines, without embedded fonts or corpus
content. The reference application opened it read-only and exported `native.pdf`
without saving. `tools/reviewed_font_reference.py web-hidden` records native
PDF text/glyph positions and source/PDF SHA-256 hashes.

ECMA-376 Part 1 section 17.3.2.44 limits `webHidden` to Web Layout view. These
seven controls cover ordinary text, direct true/false declarations, paragraph
and character inheritance, and character/direct false resets. Every line is
visible in the reference application's paginated output, as it is in the app's paginated canvas.
This is standard behavior, not a consumer divergence.

The app retains these source declarations without exposing a Web Layout
visibility command. Tests compare all seven native lines and baselines,
exercise editing and bold formatting inside a directly marked run, retain
unrelated parts, restore exact undo and reopen. Invalid values, duplicates and
unsupported declaration content remain guarded. `vanish` (hidden text in other
views) and unsupported complex-script/RTL properties remain separate guards.
