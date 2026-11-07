# Native keyboard reference

`native-keyboard.docx` is a scratch copy of `../control.docx` saved by the reference
application after focusing the first paragraph, pressing Ctrl+Home, Right, Right,
inserting X with computer-use `type_text`, and saving. `type_text` uses clipboard
insertion; this is not a physical character-key capture. `reference.json` binds
both files to SHA-256 hashes and records the resulting wrapper contents.

The first empty wrapper becomes a five-space showing-placeholder control, while
X appears outside it in `SXtart suffix`. The other five controls remain empty.
This establishes the saved result, not every intermediate caret position or a
complete navigation model. No fonts or artwork were added.

The model supports explicit before/inside/after ownership at a shared visible
offset. Browser tests supply that metadata explicitly and test repeated typing,
export/reopen, unrelated package parts, and undo. Arrow-key, pointer, and IME
integration, boundary deletion, and navigation-triggered placeholder restoration
remain pending.
