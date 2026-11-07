# Original thin crossing controls

`tools/thin_border_crossing_fixture.py` manually authors deterministic OPC/XML.
Twelve empty 2x2 floating tables cross four origins (0, 8, 9, 12 twips) with
blue/red borders of sizes 2/4, 4/2 and 2/2 eighth-points. There is no text,
image, theme, embedded font program or external resource. No corpus content
was copied. Native reference captures at 100%/200% establish all 24 internal
vertical/horizontal positions and crossing owners.

The reference-application opening helper confirmed the exact owned scratch path. Sky selected
the unique visible title, observed Saved and both zooms, cleared handles at
the blank paper corner and moved the pointer off the page. Independent paper
outlines give origins [439,260] and [247,116]. The unchanged owned source hash
equals the original after capture. `reference.json` binds all source,
case, raw JPEG and published lossless PNG crop hashes. The raw screenshots
remain private; the published geometric crops contain only original art.

Eight-pixel interior samples positioned from source declarations classify body
ink at luminance <166. Both bodies are one pixel at these two observed zooms.
Their independently measured intersection has red dominance when the authored
vertical border is wider and blue dominance when horizontal is wider or equal.
JPEG chroma changes RGB values: the record establishes these ownership/position
observations, not exact RGB, opacity, print or arbitrary-zoom agreement.

The first 100% vertical body is [71,72), with horizontal [48,49), whereas its
rounded writing centerline is 72. This shows why a crossing-priority unit must
query the painted intersection rather than freezing an old logical-coordinate
pixel. The same crossing is [144,145) x [96,97) at 200%.

Reproduce with `python tools/thin_border_crossing_fixture.py <fresh-folder>`.
Use the reference-application opening helper on an owned copy, select the recorded UI state,
then `python tools/record_thin_border_crossing.py <capture-folder>`. The capture
folder holds `thin-border-crossing-native-20261003.docx` and both
`thin-crossing-screen-{100,200}.jpg` files. Browser tests independently reproduce
native pixels and require the current viewer to match positions/ownership,
retain source geometry and export unchanged package parts.

ECMA-376 Part 1 §§17.4.38, 17.4.57, 17.4.80 and §17.3.4 govern the source
declarations. The observed raster projection is native reference compatibility, not a
normative raster algorithm or established specification divergence.
