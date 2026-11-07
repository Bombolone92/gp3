# Saved proofing-completion controls

Independently hand-authored by `tools/proofing_state_fixture.py`, without using
the Documents serializer, third-party engines or font programs. Regeneration
is byte-exact, including ZIP dates and entry order.

All three packages contain `jumpd` in an Arial 12pt, en-US paragraph:

- `proofing-clean.docx`: completed spelling and grammar, no cached errors.
- `proofing-dirty.docx`: incomplete spelling and grammar, no cached errors.
- `proofing-flagged.docx`: completed flags with a cached spelling range.

The reference application reports no spelling error for the clean control and `jumpd`
at [0,5] for the dirty control. The hash-bound `clean-native.json` and
`dirty-native.json` retain source, saved-state, selection, zoom and view guards.
Capture with `tools/record-native-proofing-state.ps1` after explicitly opening the
exact control with the reference-application opener. `flagged-native.json` records the flagged
control reporting jumpd at [0,5], with the same source and application-state guards.
For newly opened controls absent from the running-object table, the private
capture binds the exact confirmed filename with BindToMoniker.

This agrees with ECMA-376 Part 1 §§17.15.1.65 and 17.18.69: clean means checking
completed, not that text is error-free. Subsequent applications may trust the
saved state. Editors modifying text without completed spelling/grammar checking
should invalidate completion. Omitted attributes already mean dirty.

The export fix resets only existing clean attributes when checked story text
changes. Run splitting, formatting, image geometry, no-edit and undo retain
settings. Body, headers, footers, notes, comments and embedded text-box text are
covered by the common part comparison. Unit-only XML fragments exercise part
selection and drawing comparison; they are not native/schema fixture claims.
Body language/noProof changes now invalidate completion; completed body
spelling consumes cached error ranges on load. Other-story property-only edits,
grammar and other-story cached display remain open. These controls certify no
original template as fully faithful.
