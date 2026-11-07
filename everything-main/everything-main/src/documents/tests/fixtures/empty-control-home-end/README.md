# Leaving empty inline controls with Home and End

The sources are independently authored XML/OPC, not editor exports. `control.docx`
is the A + empty rich-text control + D source from `../empty-control-navigation`.
`tools/empty_control_home_end_fixture.py` creates leading/trailing variants and a
declared bold glossary prompt long enough to wrap when restored. No font binaries
or external artwork are included.

native references were saved through the actual reference application UI on September 28,
2026. Click the empty control, press the case's Home/End key, type X, and save.
For the four middle-control cases, undo typing and prompt restoration between
cases. The observed empty inside caret returns after those two undo operations.
`reference.json` records the exact protocol, source/result hashes, text, and
placeholder contents. The wrapping source was regenerated while adding the
boundary variants; its XML is unchanged, but its committed ZIP timestamps differ
from the original capture input. This is disclosed in the manifest.

Home and End restore the prompt on exit, including when the old visible offset
equals the destination. X remains outside the wrapper. End retains its logical
destination after D even when restoration wraps the prompt onto several lines.
The browser must map the old destination through restoration, not compute a new
line end inside the restored prompt. The leading Home case starts with an inside
caret: it supplements the earlier document-Home entry route rather than claiming
that every Ctrl+Home always restores an empty control.

The relevant markup is ECMA-376 Part 1 17.5.2.26/31 (run-level sdt/sdtContent)
and 17.5.2.25/39 (placeholder/showingPlcHdr). These clauses do not prescribe
keyboard transitions; the references establish the reference application's editing behavior.

Tests cover native text and ownership, prompt formatting, unrelated parts,
export/reopen, undo/redo, read-only navigation, and invalid-target atomicity.
Shift selection, pointer exits, other navigation keys, and deletion remain
outside this evidence set.
