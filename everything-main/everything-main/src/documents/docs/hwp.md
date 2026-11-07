# Hanword HWP and HWPX import

The app-authored import helpers convert HWP 5 binary files (`.hwp`) and OWPML
packages (`.hwpx`) entirely in the browser to DOCX. These helpers are retained
for future porting and are not connected to the current canvas editor. The
browser findings below describe the previous editor integration. The Hanword
original is never overwritten.
Device import, drag and drop, batch import, Puter open, and incoming file paths
share this conversion. Batch imports choose unique DOCX names and report
individual failures without discarding successful imports.

This is an import implementation, not a native Hanword editor or a lossless
round trip. There is no HWP/HWPX writer. Exact Hanword pagination and rendering
are not guaranteed. The editor shows an expandable conversion report;
unavailable fonts are substituted with installed fonts during browser import.
The editor's DOCX support also determines what can be displayed and retained
when saving.

## Supported structures

| Content | Import behavior |
| --- | --- |
| Containers | HWP 5 CFB v3/v4, FAT/DIFAT, mini streams, compressed/uncompressed records; HWPX ZIP, manifest and spine, UTF-8 and UTF-16 XML, auxiliary script/bibliography parts |
| Text | Unicode Korean and other text, character runs, tabs, line breaks, special spaces; composed characters and ruby retain visible text with conversion notes |
| Character formatting | Font names, size and relative size, bold, italic, underline variants, single/double strike, outline/shadow/emboss/imprint, color, shading, spacing, width ratio, baseline offset, kerning, super/subscript, highlighter marks (WordprocessingML highlight names or run shading, including marks over whole tables), emphasis marks, character border fills |
| Paragraphs | Named styles, alignment, indentation, spacing, tab stops and leaders (legacy half-HWPUNIT positions converted), borders with their spacing, solid fills, keep rules, automatic Korean/Latin and Korean/number spacing flags, grid snapping, line-number suppression, page/column breaks |
| Lists | Numbered, outline, and bullet definitions with every Hanword number format (Korean syllables and consonants, circled digits/letters/syllables, ideographs, the ten heavenly stems); formats the editor cannot paint are written as counted number text |
| Tables | Nested tables, grid widths, horizontal/vertical merges, every Hanword border line style (long dash, circle, thin/thick, 3D) and cell diagonals, solid fills, decorative gradient and picture cells as pictures, inherited/explicit cell padding, vertical alignment/direction, minimum row heights, cell spacing, non-splitting rows and repeated header rows |
| Pictures | PNG/JPEG/GIF; BMP/DIB (indexed, true color, bitfields and RLE), WebP and supported TIFF layouts converted to PNG; WMF/EMF rendered to PNG within the decoder's supported drawing subset. Byte-based format detection, dimensions/aspect ratio, floating anchors, wrap sides, stacking/overlap, links, alternative text, rotation/flips, crop/outsets, borders and color adjustments. Shadow/glow/soft-edge/reflection properties become DrawingML |
| Drawings | Native DrawingML rectangles/rounded rectangles (with their corner ratio), ellipses, lines, polygons, arcs (the quarter ellipse between the semi-axis endpoints as pie, chord or open arc paths), curves (smoothed through their points, closed when they return to their start), connectors as straight lines, text art as a plain text box with its font and color, solid and linear-gradient fills natively, radial/square gradients rasterized, picture fills, hatch fills as a blended color, drop shadows written as DrawingML effects, stroke formatting, text boxes and HWP/HWPX drawing groups; line caps and arrowhead types/sizes in both formats. A drawing inside a text box's own text (a framed picture, a shape drawn in the box) is lifted out into a group beside the box at its place in it: the editor cannot address any drawing-bearing paragraph of a document whose text box holds a drawing |
| Embedded objects | OLE objects and charts as the picture they display (the object's native bitmap or its cached presentation metafile); videos as their poster pictures; objects without a picture receive a named placeholder |
| Equations | Native Office Math fractions, radicals, sub/superscripts, sums/products/integrals, limits, matrices, cases, aligned piles, delimiters, accents, common symbols and functions; unsupported syntax retains the complete source with a note |
| Sections | Paper dimensions, orientation, margins, equal/unequal columns, column gaps/separators, continuous column changes, vertical text; default/even/first headers and footers, page-local suppression using source page boundaries; page borders and line numbering written as section properties; anchored master-page backgrounds placed in the matching header |
| Page numbers | Native PAGE/NUMPAGES fields, header/footer placements including mirrored inside/outside, number formats, restart values, odd/even section starts |
| Notes | Footnotes and endnotes as related DOCX parts, numbering formats, starts and restart rules |
| Links/bookmarks | External HTTP(S)/mailto and internal bookmark links, forward references, cross-paragraph fields, point/range bookmarks, Unicode name normalization and unique output names |
| Comments/revisions | HWPX MEMO field content, author/date and comment ranges; hidden comments (HWPX and binary) as comments; HWPX inserted/deleted text with authors, dates and matching ranges |
| Forms/metadata | HWPX controls (including command buttons) retain their visible labels/selection state; empty click-here fields show their guide text in gray; formula, date, path and cross-reference fields keep their displayed results; HWPX package and binary HWP summary metadata become DOCX core properties, including binary creation/modification dates |

## Fidelity limits

- Native HWP/HWPX saving, HWP 3, encrypted/password-protected, distribution-only
  and DRM-protected documents are not supported. Protected files receive an
  actionable error. Scripts are never executed or imported.
- This is a DOCX-based editor. Text-only binary HWP paragraphs retain recorded
  baseline spacing, and centered paragraphs retain their source line wraps.
  Text grids are not reproduced. A body paragraph that began a new page in
  Hanword after a page that ended early (below 80% of the text height, as
  when an object or heading moved to the next page) starts a new page here as
  well, from the recorded line positions in single-column text; pages that ran
  full break naturally, since forcing them would leave a spill page behind
  wider substitute fonts. Page borders are written
  as section properties and, because the editor does not paint them, also drawn as an
  unfilled rectangle anchored in every page header; diagonal cell borders are
  likewise drawn as lines anchored in the cell. Line numbers are drawn as small
  boxes in the left margin at the line positions Hanword recorded (the section's own
  line numbering is left out so it does not double them; a paragraph that wraps
  differently in the editor can shift them). Character borders keep their
  shading, which the editor paints, and their WordprocessingML run border, which it does
  not: the editor places any inline shape on its own line, so a box around
  the run would break the paragraph's flow.
  Browser import probes local font availability, tries equivalent Korean/English
  family names and document-declared substitute/default fonts, then substitutes
  missing families with installed fonts; the conversion report lists changes in the
  editable copy. Fonts are not embedded or downloaded. Per-script typography,
  character effects and some number formats can differ.
- Floating tables enter document flow. Captions keep their recorded side above or
  below their object; captions beside an object are placed above or below it. Binary HWP
  and HWPX groups retain their paint order and composed leaf transforms in a native
  DrawingML group. Unsupported content within groups follows the drawing in
  document flow. Skew, contour wrapping,
  complex geometry and picture effects can differ. OLE objects and charts show
  their cached picture, not a live object; text art keeps its text but not its
  warped outline; curves are Catmull-Rom approximations of Hanword's spline;
  elliptical arcs of ellipse objects are drawn whole; hatch fills are a blended
  solid color; tiled picture fills are stretched; picture fills behind cell
  text are not painted. Because the editor paints no shape or picture effects,
  a drop shadow becomes a shadow-colored copy of the object's geometry behind
  it, grouped with it (a standalone shadowed object is therefore a two-member
  group in the editor). Master pages keep only their anchored pictures and
  shapes, and only when they apply to every, every even or every odd page.
  Binary picture
  crops prefer explicit source dimensions in the optional picture extension;
  older files use readable raster sizes at 96 DPI and can differ when the source
  used another image-coordinate convention.
- Ruby becomes the base text followed by the annotation as small raised text,
  because this editor drops native WordprocessingML ruby. Overlapping characters become
  consecutive text. Forms retain visible content, not interactivity. Binary HWP
  memos become comments and its inserted/deleted ranges become tracked changes,
  both without author and date (the binary field carries none); other review
  marks stay plain text. HWPX revision formatting/moves are not mapped.
- Equations with unsupported commands (including long division, ladder,
  column-oriented matrix syntax, color/scale and relation annotations) remain
  complete Hanword source text. Unknown identifiers remain text. A native math
  result is not proof of pixel-identical mathematical typography.
- Figure/table/equation counters become SEQ fields showing Hanword's last
  value in the caption's number format; other dynamic field results become
  text. List restarts and complex field/layout dependencies can differ. The
  editor paints only decimal, roman, letter and bullet list markers, so Korean,
  circled and ideographic list numbers are counted during conversion and
  written as text in front of their paragraphs (decimal levels stay native).
  Bibliography database records are omitted while visible citations remain.
- Gradient backgrounds behind text, merged rows and conical gradients retain
  a base color. Empty, single-row decorative gradient cells retain their fill
  as bounded PNG images, with the surrounding table content still editable.
  Page hiding in paragraphs spanning pages or ambiguous column resets uses
  the starting page and receives a specific note. Subsequent editing can
  change pagination relative to the recorded Hanword layout.
- Unencrypted HWP files with digital-signature flags can be imported. Signature
  information is not verified or carried into the editable copy; the conversion
  report identifies its removal.

Warnings describe detected approximations; an empty warning list is not a
claim of lossless conversion. The editor's DOCX support also determines what
survives rendering and subsequent saves. Full native Hanword compatibility
remains unfinished; additions should be checked against real source documents,
reference renders, the WordprocessingML schema, and editor save/reopen behavior.

## Image conversion and remaining image gaps

Image formats are detected from their bytes before the filename or manifest MIME
type is considered. This matters in real HWP files: some resources declared as
PNG contain BMP data. The browser/editor cannot reliably display all native
Hanword image formats, so import prepares compatible PNG media before writing
the DOCX. Original Hanword files are unchanged. Shared media, including different
BinData IDs for one stream, is decoded once per color-adjustment variant and
uses the owning DOCX part's relationships in headers, footers, notes and text boxes.

- BMP/DIB decoding supports 1/4/8-bit palettes, 16/24/32-bit pixels, bitfield
  masks, top-down rows and RLE4/RLE8. PNG output retains the decoded pixels.
- TIFF uses a bounded first-image directory and the pinned MIT-licensed
  [UTIF decoder](https://github.com/photopea/UTIF.js). Common grayscale, RGB,
  palette, CMYK and YCbCr layouts and uncompressed, Fax 3/4, LZW, JPEG, DEFLATE
  and PackBits compression are accepted within its supported subset. Planar,
  floating-point, RAW and other unsupported layouts produce a labeled
  placeholder. Orientation is applied; only the first TIFF page is displayed.
  Codec work runs in a dedicated worker with a 15-second deadline.
- WMF/EMF uses the pinned MIT-licensed standalone
  [rtf.js renderers](https://github.com/tbluemel/rtf.js), loaded only when needed.
  Their drawing support is partial: EMF text, embedded bitmap operations,
  world transforms, EMF+ and some geometry are not fully reproduced. Imports
  always report this approximation; an empty render becomes a placeholder.
  Output is rasterized at up to twice the largest displayed size, capped at
  4096 pixels per side. This is not lossless vector preservation.
- Crop coordinates retain outsets and the `-1` no-crop sentinel. Binary picture
  tails now retain explicit source dimensions, image/border transparency and
  supported effects. HWPX pictures retain links, wrap side, overlap, stacking
  and source dimensions. Missing pictures retain their description and caption.
- Grayscale, black/white, brightness, contrast and transparency are baked into
  image variants for reliable editor display; exact Hanword color processing
  can differ. Native crop, size, rotation and flips remain editable. Borders,
  shadows, glow, soft edges and reflections are written as DrawingML, but their
  on-screen rendering still depends on the editor. In the previously checked
  editor version, the real picture fixture's shadow/glow/soft-edge/reflection settings
  survive export but are not painted on screen. Advanced effect color spaces,
  grouped transforms and shape/table picture fills remain incomplete.

Decoded rasters are limited to 16 megapixels each, 64 megapixels of conversion
work per import and 96 MiB of encoded output. TIFF tags, strip/tile sizes and
DEFLATE expansion are checked before/during decoding; page and EXIF chains are
not traversed. Metafiles have an 8 MiB input limit and bounded record/point
counts. Generated SVG stays detached, disallows active/external content, and
is used only as an image source for local rasterization. No linked image is fetched.

## Implementation and format investigation

`src/lib/hwp/binary.js` reads little-endian CFB streams, bounded record trees,
and raw DEFLATE. `hwp5.js` decodes DocInfo definitions and BodyText sections.
`hwpx.js` validates the ZIP package and reads XML by namespace-local names,
using the package spine for reading order. Both produce the same document
model; `equation.js` parses the bounded equation language, `image.js` reads
raster dimensions without decoding pixels, `metadata.js` reads bounded OLE
summary properties and code pages, and `docx.js` writes native WordprocessingML
content and owning-part relationships into an OOXML package. `fflate` supplies compression only.
The converter loads on demand so ordinary DOCX editing does not load it.
`prepare-images.js` handles editor-compatible media, `bitmap.js` supplies the
portable BMP/DIB decoder and PNG encoder, and `picture-effects.js` reads the
optional binary picture tail. TIFF and metafile dependencies load on demand.

Several interoperability details were checked against actual file bytes:

- HWP record headers encode a 10-bit tag, 10-bit level, and 12-bit size, with
  an extended size after `0xfff`. Sections must sort numerically.
- Legacy tab positions are half HWPUNITs: the binary TAB_DEF and `secd`
  default tab, and the HWPX default switch branch, store a 40 pt tab as 8000
  where the HwpUnitChar branch and `tabStopVal` store 4000. A real report's
  tab at 65754 lies beyond an A4 page unless halved. The HWPX reader prefers
  the HwpUnitChar branch; other unreadable branches (OOXML charts) fall back
  to the default branch, which holds the object's OLE form.
- The solid fill of a binary shape is color, hatch color and hatch type, where
  `-1` means no hatch; picture brushes are six bytes (mode, brightness,
  contrast, effect, BinData id); the extension block's first byte is the
  gradient's blend center. Hanword's `.ole` entries and BinData OLE streams
  are a 4-byte length followed by an OLE compound file whose `Ole10Native`
  stream (length-prefixed) or `OlePres000` presentation stream (WMF at the
  data offset, no METAFILEPICT header) carries the displayed picture.
- Binary memos, cross-checked against hwplib's reader: the `%%me` field marks
  the commented range in the text, and the memo's text follows the paragraph
  as a `MEMO_LIST` record (its memo shape index) with a list header (paragraph
  count, properties, text width and height) and paragraphs beneath it; memos
  are taken in the order their fields occur. hwplib also confirms the field
  ids (`%%me`, `%%*e` simple insert, `%%*d` delete) and that a range tag's
  fourth byte is its kind.
- Binary range tags (`PARA_RANGE_TAG`) of kind 2 (high byte) are highlighter
  marks over `[start, end)` text positions with a COLORREF in the low 24 bits,
  as hwplib's `etc.hwp` shows. Real bookmark parameter sets write a `0x4000`
  word between the item id and its string type. Overlapping letters (`tcps`)
  start with a character count and the letters themselves. Index marks
  (`idxm`) print nothing.
- The government notice in `ksconv-samples` confirms the highlighter range
  `[2, 9)` covers exactly "(수강 방법)": the end position is exclusive. Its
  kind-0 range tag over the whole paragraph is ignored.
- Arc records hold the ellipse center and two semi-axis endpoints; the arc is
  the quarter between them (`P(t) = C + cos t·u + sin t·v`), which one cubic
  Bézier reproduces in any affine frame. Grouped connectors can be scaled to
  zero width, so a zero scale on one axis is a valid drawing transform.
- Extended paragraph controls occupy eight UTF-16 positions. Formatting run
  offsets count those positions even though the controls produce no text.
- Actual border-fill records interleave each side's type, width, and color.
- Modern table LIST_HEADER records use a 32-bit paragraph count; early cell
  records use 16 bits. Caption lists precede the TABLE record and must not be
  decoded as cell addresses. Cell paragraphs can be siblings of LIST_HEADER.
- Picture records reference the DocInfo BinData list; the image identifier
  follows 71 bytes of picture properties.
- Binary paragraph margins use half HWP units. Negative HWP indentation uses
  a different origin from WordprocessingML hanging indentation. Resolved paragraph shapes
  explicitly disable inherited list numbering where the source does so.
- HWPX switch branches are alternatives. Only the default branch (or first
  case if absent) is imported. A nested table's metadata must not be used as
  its containing cell's address, dimensions, or span.
- HWPX files can include JavaScript in the package spine. These auxiliary parts
  are skipped, not interpreted as sections. Negative drawing offsets can be
  serialized as unsigned DWORD values; those are converted back to signed units.
- A column control later in the same body section starts a new continuous DOCX
  section. It must not retroactively change the layout of earlier paragraphs.
  Single-column controls inside tables and text boxes need no approximation.
  Page hiding controls in those objects apply to the containing body page.
- Hanword equation terms are separated by whitespace. For example, `10a^3 over
  2b` has the entire `10a^3` term as numerator, and `sum_n=1^N` has `n=1` as the
  lower limit. Group braces, control nesting and source fallback are bounded.
- Media and hyperlinks belong to their owning DOCX part's relationship file,
  including headers, footers, and notes.

Primary references:

- [Hancom HWP 5.0 specification, revision 1.3](https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf)
- [Hancom equation specification, revision 1.3](https://cdn.hancom.com/link/docs/한글문서파일형식_수식_revision1.3.pdf)
- [Hancom official OWPML model](https://github.com/hancom-io/hwpx-owpml-model)
- [Hancom HWPX package structure](https://tech.hancom.com/hwpxformat/)
- [[MS-OLEPS] OLE Property Set data structures](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oleps/6e65d6fa-6044-4e23-ae71-d65d1e3b1249)
- [[MS-CFB] Compound File Binary file format](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b)
- [ECMA-376 Office Open XML](https://ecma-international.org/publications-and-standards/standards/ecma-376/)

The independently written decoder was cross-checked against public
[hwp.js](https://github.com/hahnlee/hwp.js) fixtures and record field
definitions, and [pyhwp](https://github.com/mete0r/pyhwp) numbering definitions.
Neither implementation is bundled. Committed interoperability fixtures have
upstream licenses and provenance under `tests/fixtures/hwp/` and
`tests/fixtures/hwpx/`. The HWPX samples come from
[hwpxlib](https://github.com/neolord0/hwpxlib).

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

## Limits and validation

Imports are limited to 32 MiB of source bytes, 96 MiB of expanded data, 256 MiB
of generated DOCX parts before ZIP compression (including media), 2,000,000
records/XML elements (a 10 MB report with 147,000 paragraphs holds 640,000), depth 64, 20,000 table grid cells across the document,
1,000 sections, and 4,096 ZIP entries. Fields/revisions are limited to 64
simultaneously open ranges per story. Equations are limited to 65,536 source
characters, 16,384 tokens, depth 64 and 4,096 matrix cells. Readers check bounds, chain cycles,
record nesting, XML entities, ZIP sizes and CRCs, duplicate paths, and table
cell overlaps. XML generation checks accumulating content as well as total
output bytes so reused formatting cannot create an unbounded output package.
XML element counts and nesting are checked before allocating a DOM tree.
Parsing does not fetch linked resources or execute document
content. Unsupported or corrupt data is not replaced with preview text and
presented as a successful document import.

Run `npm test` and `npm run build`. Tests cover container integrity, format
mappings, output budgets, protected/corrupt data, batch imports, name collisions,
and preserving cloud originals. `tests/hanword-fidelity.test.js` adds structural
assertions for math, fields across paragraphs, Korean bookmarks, comments,
revisions, shapes, page-number rules, column transitions, table inheritance,
UTF-16, metadata and real HWPX fixtures. Generated XML and relationship targets
are checked; XML well-formedness alone is not schema or rendering validation.
`tests/hanword-images.test.js` adds actual codec/pixel checks, all three WebP
dimension headers, BMP palettes/RLE/DIB, TIFF byte orders/expansion limits,
metafile framing, binary image tails, crop sentinels/outsets, links, captions,
effects, shared media across stories and the real `SimplePicture.hwpx` fixture.

The September 2026 investigation additionally converted a public corpus of 87
files: 49 HWPX files from hwpxlib, two HWP files from hwp.js, and 36 HWP fixtures
from pyhwp. All 85 unprotected files converted; the two protected HWP fixtures
were rejected as expected. All 85 generated DOCX packages passed
the open-source [Open XML SDK validator](https://github.com/dotnet/Open-XML-SDK)
(version 3.5.1, newest file-format version) with zero validation errors. The corpus and
SDK were temporary development tools, not new application dependencies. This
checks conversion and package conformance, not visual equivalence with Hanword.

Historical browser verification used the previous editor and the local Puter mock:
`SimpleEquation.hwpx`, `ChangeTrack.hwpx`, an independent HWPX sample containing
a comment, text box and ruby, and `basicsReport.hwp` were imported, exported,
and reopened. Native math, inserted/deleted text, comment content and shape
text survived export. Five checked editor-exported packages also passed the
Open XML SDK validator with zero errors. The report rendered as eight pages
against six recorded in its source metadata; its cover spacing also differed
from the source preview. These remain layout limitations, not a successful
pixel-fidelity comparison. Browser cold-start times in the development harness
required extended timeouts and are not performance benchmarks.

The image follow-up verified all 85 unprotected corpus files through the actual
browser `convertHanword()` entry point: the resulting packages contained 96
media parts and no picture-failure placeholders. All 85 packages and the three
checked editor exports passed Open XML SDK validation with zero errors. A
mixed PNG/BMP/TIFF/WMF/EMF fixture was decoded in the browser with sampled pixel
checks, imported into the previous editor, saved and reopened; its six pictures
and native crop survived export. `basicsReport.hwp` retained its three converted bitmaps.
`SimplePicture.hwpx` retained its JPEG and all four advanced effect definitions
on export, although the editor did not paint those effects. The converter's
image tests also cover independent WMF/EMF fixtures with upstream provenance.
The full suite passed 565 tests with `npm test -- --maxWorkers=2`; the production
build passed. An earlier highly parallel run hit timing failures under machine
load; those did not reproduce with bounded concurrency.

## AI voucher guide regression

The 2022 AI voucher guide exposed additional rendering issues: modern polygon
records use a DWORD point count, grouped artwork must share one inline extent,
and legacy private-use arrows and bullets need Unicode equivalents. Its BMP
logos and diagram use the compatible PNG preparation path. Blank paragraph
formatting, source baseline spacing, centered title wrapping, gradient cell
fills, page breaks before tables and merged artwork row heights are now
retained. Partial vertical merges are not repeated as table headers.

The new drawing and typography tests use independently generated fixtures;
the user's document is not committed. Browser checks on the actual guide cover
the complete document, all three embedded images, the contents banner, arrows,
and export/reopen. Substituted font faces remain a visible difference from
the embedded Hanword preview. The gradient follow-up below replaces the
earlier solid-color approximation.

Validation for this regression: 580 tests passed, the production build passed,
and all 85 unprotected interoperability corpus files still converted and passed
Open XML SDK validation. The guide and its editor-exported copy also passed
validation. All 29 rendered pages were inspected; the three images decoded and
the saved copy reopened with the same page count.

## Arrow, group and font follow-up

Binary HWP line flags now retain arrowhead types, independent start/end sizes
and line caps. HWPX additionally retains spear arrows and start/end sizes.
Horizontal and vertical lines keep zero extents instead of receiving a square
default drawing box. The editor's vector container is allowed to paint SVG
markers outside the line's bounds, preventing clipped arrowheads on screen.
Known legacy private-use arrows and bullets are normalized in HWPX as well as HWP.

HWPX containers now produce one DrawingML drawing group. Complete leaf matrix
sequences retain position, scale, rotation and reflection without reapplying
ancestor transforms. Nested containers retain source paint order; pictures,
text and missing-picture placeholders remain in the group. The independently
authored cases cover zero-height grouped lines, nested matrices and malformed
geometry. The upstream `SimpleContainer.hwpx` fixture covers two scaled pictures
and their connecting line.

Font resolution tries localized aliases and source-declared substitutes before
generic installed families. Binary optional font records and HWPX `substFont`
entries are read without fetching or embedding font resources. Candidate lists
are bounded; unavailable original faces can still have different metrics.

These mappings still have limits: square line ends use diamonds, hollow closed
ends use filled ends, and hollow triangular arrows use open arrows. DrawingML arrow
sizes are relative to stroke width and can differ from Hanword. The previously
checked renderer also places native head/tail decorations at opposite endpoints
to the Hanword start/end properties; the DOCX retains its native end properties.
The real `SimpleLine.hwpx` sample still differs from its Hanword preview.

Validation: 619 tests passed with bounded concurrency, and the production build
passed. All 85 unprotected corpus imports passed Open XML SDK validation. Browser
checks covered a synthetic arrow/font fixture, `SimpleContainer.hwpx` and
`SimpleLine.hwpx`, including screenshots and save/reopen; all six imported and
editor-exported packages passed schema validation. The group retained both images
and its line, and arrowheads were visible after the clipping fix. These checks
did not verify the user's newly reported file at that time.

## AI voucher conversion-note follow-up

The actual 2022 AI voucher HWP was inspected locally. Its four reported notes
had different causes:

- The cover's lower rule uses a radial gradient from `0080c0` to `3cbfff`,
  centered at the top left, with 50 color steps. The binary reader retains
  its colors, positions and blend parameters. The fill is rendered in source
  coordinates as a PNG at twice screen resolution; a native DrawingML radial
  gradient painted incorrectly in the editor's thin rule. Zero cell padding
  and a small paragraph mark retain the rule's source height. Each raster is
  capped at 2048 pixels per side, with a 16-megapixel aggregate fill budget;
  identical fills share media and each story owns its image relationship.
- Both the cover and contents page hide page numbers. Hiding controls inside
  the contents table now reach the containing page. Explicit page breaks and
  recorded single-column line positions identify page starts; a DOCX section
  starts on each affected later page, with page numbering continuing. The
  replacement section break consumes the original paragraph page break.
- Known legacy symbols use their Unicode equivalents without a loss warning.
  Unmapped private-use characters remain intact.
- The nested column control specifies one column. It no longer receives a
  simplification warning; nested multiple-column flows still do.

Fill warnings now refer to backgrounds actually used by document content,
rather than every definition stored in DocInfo/header XML. Picture backgrounds
and unsupported gradients retain specific notes; the guide contains no picture
background fills. Font substitutions and oversized tab-stop notes are separate
and may still appear for this guide.

Regression tests in `tests/hanword-layout-controls.test.js` cover both input
formats, later and nested hiding controls, automatic page boundaries, footer
relationships, nested columns, PNG pixels and dimensions, unused fills and
malformed gradients. Browser inspection of the actual guide confirmed the
cover gradient, no number on pages 1–2, and continued numbers 3–4. Import and
save/reopen retained 29 pages. Both generated packages passed Open XML SDK
validation with zero errors. The full suite passed 633 tests and the production
build passed; all 85 unprotected corpus files converted and passed schema
validation, with the two protected files rejected. The user's source remains
outside the repository.

## Parity follow-up (September 13, 2026)

A public corpus of 122 files (49 hwpxlib HWPX samples including its `error/`
regression documents, two hwp.js fixtures, and pyhwp's fixtures and samples)
was reconverted after each change; the four password-protected fixtures are
rejected as before and the other 118 convert. The changes and what they rest on:

- Tab stops: every legacy tab value is half a HWPUNIT (see the investigation
  list above). Both readers halve them; a real report's tab and default tab
  now fall inside the page, and the 22-inch warning no longer fires on
  ordinary documents.
- Highlighter marks, hidden comments, click-here guide text, formula and
  displayed-text field notes, command buttons, contents markers, cell
  diagonals and the full border style list, including the invalid `longDash`
  value the binary map used to write.
- Arcs, curves, connectors, text art, OLE objects, charts and videos, and the
  gradient, picture and hatch fills of shapes, with rounded-corner ratios and
  shape shadows. In the previously checked editor version, custom geometry with
  `cubicBezTo`, `blipFill`, `gradFill`, solid-fill alpha, `w:highlight` and run
  shading render; `pattFill` paints as its foreground color (hence the blend),
  and `outerShdw`, `w:bdr`, cell diagonals, `pgBorders` and `lnNumType` are
  written but not painted.
- Emphasis marks, character border fills, paragraph border spacing, automatic
  spacing flags, grid snapping, line-number suppression, page borders, line
  numbering and anchored master-page backgrounds.
- Emulations for what the editor leaves unpainted, each confirmed in the
  browser: page borders as header-anchored rectangles, diagonal cell borders
  as in-cell anchored lines, drop shadows as grouped shadow-colored copies,
  ruby as small raised text, line numbers as margin boxes at the recorded
  line positions; and binary memos as comments plus binary insert/delete
  fields as tracked changes. Inline `wps` shapes are placed on their own line
  by the checked editor (inline pictures stay in the text), so no emulation
  can sit inside a line of text; character borders therefore stay as shading,
  and a text-free drawing treated as a character inside a line of text is
  rasterized in the browser to a picture of its own size so it keeps its
  place in the line (drawings with text, anchored drawings and drawings alone
  in their paragraph keep their editable shape form). Recorded page starts
  become page breaks so pagination follows the Hanword file.
- HWPX text-only paragraphs keep their recorded line heights like binary ones
  (the 108-page report lays out in 104 pages), caption numbers are SEQ fields
  in their number format, Korean and circled list numbers are written as text
  because the editor paints only decimal, roman, letter and bullet markers, and
  captions keep their top/bottom side (most corpus captions sit above their
  table). The whole corpus also converts in the browser through the real
  `convertHanword()` entry point without placeholders.

Three real government documents from `DesignTheHAM/ksconv-samples` (a 3 MB
notice of 42 pages, an FAQ and an HWPX design competition brief) convert and
render without placeholders; the notice's highlighter, pictures, tables and
overlapping letters were checked on screen.

hwplib's own 44 `sample_hwp` documents were added to the corpus afterwards:
they carry real binary arcs and curves, OLE objects, a chart, a drawing group,
hidden comments, ruby, overlapping letters, highlighter range tags and a
real bookmark parameter set, which fixed the bookmark-name decoding and
added the binary highlighter. 43 convert; the distribution-only copy is
rejected as designed. The 10 MB stress file of 147,000 identical paragraphs
first exceeded the output limit (its resolved formatting wrote about 280 MB
of XML); the writer now states a paragraph mark's formatting only on empty
paragraphs, leaves out all-nil paragraph borders unless the style would draw
one, and carries the language in the document defaults and styles alone,
which changes nothing visible and brings that file to a 5 MB package. Its
chart holds only Hancom's native chart data, no picture, so it receives a
named placeholder.

Browser checks used the actual editor on the hwpxlib arc, curve, connector,
text art, OLE, video, equation, container and highlighted-table samples, the
chart regression file (its OLE presentation metafile renders as the chart
picture), pyhwp's tab and text box fixtures, `basicsReport.hwp`, and the
7 MB disaster-report HWPX (108 pages, 492 shapes, 110 tables). Pagination
still differs from Hanword; the tests in `tests/hanword-parity.test.js`
cover the new mappings with independently generated fixtures.
