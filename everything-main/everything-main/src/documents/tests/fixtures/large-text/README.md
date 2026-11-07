# Large document editing control

`python tools/large_text_fixture.py tests/fixtures/large-text` manually authors
this deterministic DOCX with stdlib ZIP/XML strings. No third-party document
engine, font program, corpus text or artwork is used. It contains 120 original
1,000-character paragraphs: 120,119 UTF-16 positions including separators.

The fixture exceeds the former 100,000-character ceiling. Unit and browser
checks cover editable import, complete text, rendered pages, insertion after
the former limit, export/reopen, unrelated package parts and byte-exact undo.
The new 5,000,000 ceiling also has import, preview, search and atomic-edit
boundary tests. The ceiling is an application resource limit, not OOXML syntax.
Tests do not claim that every possible five-million-character document has
equal latency or reference pagination. Ordinary archive and layout bounds still apply.
