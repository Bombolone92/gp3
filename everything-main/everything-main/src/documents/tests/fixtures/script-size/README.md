# Native script-size controls

The source XML is independently authored by `tools/script_size_fixture.py`.
It uses the repository's original book-fold control only as a minimal OPC
package skeleton; no corpus document content is used.

Regenerate the source with that script, export `control.docx` to `native.pdf`
using `tools/export-reference.ps1`, then run
`tools/script_size_reference.py` on the Windows reference machine. The
reference was captured with the reference application. The recorder requires the nine
installed font faces identified by filename/hash in `reference.json`.
It copies only numeric font facts, not font binaries.

The nine pages cover 108 combinations of font family, face, declared size
and script position. Native font identity is verified for every measured run.
`tests/script-size-native.test.js` checks evidence integrity and observations;
it is not a renderer-fidelity test. `script-font-size.test.js` and the matching
browser suite now check the native sizing rule when static font metrics are
available. Vertical baseline placement remains open; see the conformance
notes and earlier controlled OS/2 font experiments.

The 2026-09-30 `script-horizontal-origin` browser regression now requires all
108 absolute horizontal origins to agree within 0.2 pt. The prefix-kerning
fix (3dfae0fc) and removal of the invented italic translation resolve the
previous expected failure. This does not establish vertical placement agreement.
