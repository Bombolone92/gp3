# Keep-with-next at empty section boundaries

`tools/section_keep_fixture.py` writes original XML using the existing original
book-fold control as a minimal OPC package skeleton. No corpus XML is copied.
Export each source with `tools/export-reference.ps1` to the matching
`NAME-word.pdf`, then run `tools/section_keep_reference.py`. References were
captured with the reference application and are bound to source/PDF SHA-256 hashes.

The ten sources distinguish empty and text-bearing section boundaries, keep
on/off, after-spacing, preceding tables, continuous/next-page sections, an
empty preceding paragraph and a longer keep chain. The reference application's 22 reference pages
show that an empty section boundary does not extend a preceding keep chain.
The source paragraph and its formatting remain present for subsequent edits.

Unit tests verify native page assignments and caret/hit testing. Browser tests
check actual font-measured origins, visible page counts, editing, untouched
package parts, undo and reopen. A separate typing scenario turns the empty
boundary into real text and restores ordinary keep behavior.
