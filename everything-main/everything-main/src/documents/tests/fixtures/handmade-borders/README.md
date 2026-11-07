# Handmade art-border investigation

`tools/handmade_border_fixture.py` independently authors four pages with the
standard `handmade1` art border: sizes 8, 21 and 40 with text-relative placement,
plus size 21 with page-relative placement. Every side has 12pt spacing and blue
ink. No source template artwork or markup is copied.

`native.pdf` is the native reference; all four pages were inspected.
`tools/record_handmade_borders.py` binds source and PDF hashes. The source passes
standard and supported extension schema checks. The native border has irregular
filled edges and corner joins, rather than an ordinary uniform line. Size changes
affect its frame and ink. It is represented as vector paths in the native PDF.

Specification: ECMA-376 Part 1 §17.6.10 (`pgBorders`), the page-border sides and
§17.18.2 (`ST_Border`, `handmade1`). Art border sizes use points, unlike the eighths
of a point used for line borders. The renderer currently rejects this art style;
these are investigation controls, not a claim of implemented support or a
demonstrated reference/spec divergence. The four pages do not establish all art-border
styles, side combinations, visibility or edit behavior.

## Native geometry checkpoint (2026-09-27)

The recorder now retains the blue filled-path bounding boxes in PDF points
(left, bottom, right, top), in addition to source/PDF hashes. All four native
pages were inspected again. Size 8 emits twelve blue path objects: four corners
and two pieces for each long side. Sizes 21 and 40 each emit eight objects: four
corners and one per side. The page-relative size-21 case also emits eight.
Object count alone does not establish the general repeat/stretch algorithm.

For text-relative sizes 21 and 40, the horizontal side pieces begin at about
60.024pt and end at 552.100pt; increasing size extends the artwork outward while
retaining that span. The page-relative size-21 horizontal pieces instead span
33.000pt to 579.100pt. Ink bounds are not nominal border-box bounds: irregular
artwork leaves gaps inside its allocation, so ordinary line width cannot be
inferred from these extrema. The measurements provide a geometry reference,
not a replacement artwork definition or a new reference/spec divergence claim.

Implementation remains pending artwork licensing approval recorded by the
existing local investigation. No artwork assets, path contours, font files or
runtime changes are included in this checkpoint. Corpus document #353 stays partial.
