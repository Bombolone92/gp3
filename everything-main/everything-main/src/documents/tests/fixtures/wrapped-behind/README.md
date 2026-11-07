# Wrapped pictures with behindDoc

`tools/wrapped_behind_fixture.py` independently authors the OPC/XML and solid-color PNGs. The eight pages cover top-and-bottom wrapping relative to column, page and margin, plus numeric square wrapping relative to column, each with behindDoc false and true. No third-party document engine is used.

`native.pdf` was exported from the reference application. Every page places the blue picture at (72,86) with size 72×36 pt, and the red front picture at (90,86) with the same size. The blue order is 0 and red order is 1. Both wrapping modes still reserve/exclude text when behindDoc is true. Body labels remain editable; tests exercise no-edit preservation, edits, unrelated parts, undo and reopening.

The browser regression samples the two colors, overlap and surrounding white pixels. The unit regression checks retained booleans, coordinate bases and invalid boolean rejection.
