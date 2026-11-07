# Completed body spelling controls

`tools/cached_proofing_fixture.py` hand-authors these OOXML packages from the
independent proofing-state control. It does not use the Documents serializer,
another editor engine or font programs. Fixed ZIP dates/order make regeneration
byte-exact. Run it with `--output-folder` to compare against the committed files.

The nine cases exercise valid words in marked ranges, unmatched starts/ends,
multiple starts sharing the next end, cross-paragraph ranges, partial words,
noProof, grammar-only boundaries and UTF-16 offsets. Each `*-native.json` is a
hash-bound reference body SpellingErrors capture. Source bytes, saved state,
selection, zoom and view remained unchanged. Preserve the original BOM/CRLF
capture bytes; JSON consumers remove the BOM explicitly.

Each file was explicitly opened by the reference opener before reading the exact
document. Newly opened controls absent from the running-object table were bound
by their exact confirmed filename with BindToMoniker. The public
`tools/record-native-proofing-state.ps1` recorder requires an existing exact ROT
entry and reads the full body; it does not implicitly open another document.

ECMA-376 Part 1 §§17.13.8.1 and 17.15.1.65 permit saved checking completion and
pair each spelling start with the next spelling end. Orphans are ignored.
The reference application checks whole words intersecting partial anchors, validates a flagged word
against its dictionary and honors noProof. These controls establish that bounded
behavior; they do not establish dictionary/locale equivalence, grammar checking,
other-story spelling or full corpus-document fidelity. No reference/spec divergence is
claimed. Supported control/hyperlink/table formatting mutations are additional
unit/schema cases, not separate native captures.
