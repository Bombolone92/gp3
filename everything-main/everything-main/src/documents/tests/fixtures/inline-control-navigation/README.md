# Inline content-control navigation in the reference application

`inline.docx` and `placeholder.docx` are independently authored OOXML: ordinary
A, a persistent rich-text control containing BC, then ordinary D. The latter has
`w:showingPlcHdr`. `tools/inline_control_navigation_fixture.py` reproduces their
markup without the application exporter. ZIP timestamps/serialization can differ;
the manifest binds the exact sources used for the native captures.

`word-*.docx` were saved from the reference application after actual computer-use arrow
keys and a physical `Shift_L+x` key chord. The reference manifest records text,
control contents, placeholder state, and source/result SHA-256 values. Between
cases, the inserted marker was undone. The two exit cases start from the entry
caret/selection restored by Undo, then move outward. The listed keys express the
equivalent navigation route from the unchanged ABCD source.

From Home, one Right stops before the control; another enters it at the same
visible offset. From End, one Left stops after it; another enters at its end.
Typing at the outside stops preserves BC; typing at the inside stops changes it
to XBC or BCX. Moving Right out of the inside end retains the visible position
but changes ownership. Entering a placeholder selects BC; typing replaces the
prompt, while Right leaves it intact and inserts outside. These are interactive
reference behaviors, not additional text characters prescribed by OOXML.

The editor now applies these transitions for ordinary Left/Right navigation in
nonempty persistent rich-text inline controls. A focus-only outline indicates
inside ownership; explicitly hidden control appearances stay hidden. Shift and
word navigation retain their existing paths. Empty-control prompt restoration,
pointer targeting, temporary/plain-text/picture-control boundary navigation,
and the full range of modified-key behavior remain outside this implementation.
No font binaries or artwork are included.

Follow-up: ordinary arrow exit from an empty control now restores its prompt as
one undoable edit. The native entry/exit and undo evidence is in
`../empty-control-navigation`; entry itself still preserves the empty wrapper.

Profiling note: control navigation and the active outline currently find ranges
by walking runs. The small-fixture key/paint measurement does not establish cost
in documents with thousands of controls. Record that as a future profiling
question; this change introduces no range cache or indexing system.
