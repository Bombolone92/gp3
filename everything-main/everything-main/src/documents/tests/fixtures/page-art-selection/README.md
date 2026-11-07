# Page-art selection and partial-side controls

`control.docx` is independently authored OOXML from
`tools/page_art_selection_fixture.py`, using the repository's minimal OPC shell.
Its 21 textless 300x220pt sections contain no images, font programs, or copied
border tiles. `cases.json` records the declarations in canonical top, left,
bottom, right order. The generator refuses to overwrite existing evidence.

The source was opened in the reference application. Two guarded read-only captures of
page `EnhMetaFileBits` used `tools/capture_print_section_metafiles.ps1` against
the exact visible, saved source. Both retained its SHA-256. All 21 native EMF
hashes and the recorded polygon metadata matched between captures.

`native-reference.json` records only numeric EMR_POLYGON16 bounds, point counts,
point-byte hashes, solid brush colors and mapping snapshots. `repeat-proof.json`
binds the two capture metadata hashes and the matching page hashes. The private
metafiles, polygon vertices and normative tile pixels are not bundled. The
recorder rejects unknown drawing records and nested EMF+ drawing commands;
it is not a rasterizer. Declared bounds are producer metadata in logical units,
not measured ink pixels or a full browser/native fidelity reference.

## Bounded native findings

- Single art sides produce three polygons (edge and adjacent corners).
  Adjacent pairs produce five, opposite pairs six, and left/bottom/right seven.
  Four art sides produce eight.
- The unequal widths 7/14/21/31 are selected once for the frame. Across the four
  permutations, the first declared art side selects the width: the first corner
  viewport extent is 58, 258, 175 or 117, respectively. When top is ordinary and
  the remaining sides are 21pt art, the extent is 175. This rules out taking the
  first ordinary declaration as the art width.
- With exactly one art side and three ordinary sides, the top-, left- and
  bottom-art cases produce no art polygons. The right-art case produces eight;
  its recorded polygon metadata equals the uniform 7pt control. In these
  canonical declarations, the final side's art/ordinary state gates the frame.
- An ordinary top with three 21pt art sides produces eight polygons, whereas
  omitting top produces seven. Ordinary and absent sides are not equivalent.
- Every recorded solid brush honors authored RGB `223344`. This extends the
  earlier monochrome `handmade1` color divergence evidence.

These controls do not prove rules for other art styles, `nil`/`none`, theme or
automatic colors, custom relationship borders, every possible size, or malformed
side order. Viewport values are native integers; do not infer universal rounding
or replace them with ordinary eighth-point line-border widths.

## Reproduction and remaining work

Generate into a fresh directory with `python tools/page_art_selection_fixture.py
--output-folder DIRECTORY`. After opening that owned source in the reference application, capture
with the guarded tool and its expected SHA-256. Record each private capture with
`python tools/record_page_art_selection.py CAPTURE_ROOT --output NEW.json`.
Run `python -m unittest discover -s tools -p test_page_art_selection.py` for the
source, metadata, repeat and rejection checks.

ECMA-376 Part 1 §§17.6.2, 17.6.10, 17.18.2 and normative Annex F define the
border declarations and resources. Rendering is still missing. Approval for
the eight normative `handmade1` tiles under Ecma's custom copyright terms is
pending under the user's licensing constraint. No tiles are included or read
by these tests. After approval, implement the general frame painter and verify
independent held-out geometry, color, clipping, editing and preservation cases.
