# Script-metric notice controls

`script_metric_notice_fixture.py` independently authors both DOCX packages,
the one-pixel picture, and all outlines/tables of `control.ttf`. The font and
generated assets use the accompanying MIT license; no third-party font program
or source template artwork is included. The source regenerates byte-for-byte.

The browser registers the original face only as a CSS FontFace, reproducing an
available installed face whose metric data has not been granted to the app.
No system font enumeration, binary access or permission grant is used. Loading
the same original font through the font-file UI supplies its metrics and must
clear the notice without changing document parts or creating an undo step.

Controls distinguish body superscript/subscript, a header-only script, bundled
script metrics, ordinary text, and script formatting inherited by a picture.
Picture-only formatting must not retain a text notice. Removing the actual
script formatting clears it; undo restores it. This verifies disclosure and
refresh behavior, not new native script sizing or placement.
