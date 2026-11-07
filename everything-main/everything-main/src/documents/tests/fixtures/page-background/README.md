# Page background and automatic text color

`tools/page_background_fixture.py` authors two original OPC/XML documents with
dark (0A3556) and light (EFEFEF) solid backgrounds. Each has two pages and eleven
controls: automatic text, white/dark paragraph shading, yellow/black highlight,
white/dark run shading, explicit black text, transparent/white table cells, and
automatic text on a second page. No application serializer creates the controls.
The package shell and unused artwork come from this project's original ellipse
fixture. The reference application exported both PDFs without saving the sources.

The independent PDF recorder binds source/PDF hashes, samples both page fills,
and reads PDF text fill operators. The reference application chooses white automatic text on the dark
page and black on the light page. Run/paragraph/cell shading overrides that
background for contrast. Highlighting does not: the reference application keeps white text on yellow
highlight on the dark page, and black text on black highlight on the light page.
Explicit black remains black. This deliberately preserves the reference application's behavior even
where highlighting reduces readability.

ECMA-376 Part 1 §17.2.1 defines the document-wide background, RGB/theme precedence
and tint/shade. §§17.3.2.6, 17.3.2.15 and 17.3.2.32 define text color, highlight
and run shading. Automatic foreground selection is consumer-defined; this is
reference compatibility evidence, not an explicit contradiction of the specification.

The implementation supports solid RGB and resolved theme backgrounds. Original
background/theme XML survives unrelated edits. Drawing/gradient/image background
children remain guarded for editable import and receive a read-only preview.
The control does not establish automatic contrast for every border or DrawingML
text scenario, nor does it certify all possible intermediate RGB thresholds.
