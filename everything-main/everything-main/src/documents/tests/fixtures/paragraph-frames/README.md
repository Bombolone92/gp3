# Paragraph frame placement: unresolved rendering controls

`tools/paragraph_frames_fixture.py` manually writes these five original OPC/XML
documents using only Python's standard library. They use Arial by name, with
no embedded font, corpus text, artwork or third-party document engine.

- `page`: a 144 by 72 point frame positioned at x/y=144 relative to the page.
- `margin`: the same offsets relative to the page's 72 point margins.
- `style`: placement inherited from a paragraph style rather than direct pPr.
- `grouped`: two adjacent paragraphs with identical framePr values.
- `different`: adjacent frame paragraphs differing in height by one twip.

ECMA-376 Part 1 §17.3.1.11 defines frame presence, grouping of adjacent
paragraphs with identical attribute values, and anchoring to the next non-frame
paragraph. These are distinct from DrawingML floating-picture anchors. Full
support also needs width/height rules, paragraph anchoring, alignment, wrap
distances, drop caps and interaction with cells, columns and page stories.

Fresh reference read-only captures record `*-native.json`, bound to source
SHA-256 hashes. The reference application recognizes one frame in the first four cases and two in
`different`; inherited placement and one-twip grouping separation are verified.
Its frame API reports about 143.95 points for the authored 144 offsets. These
are frame-property records, not glyph origins, PDF comparisons or evidence for
a layout compensation. No reference/spec placement divergence is claimed from them.

The viewer silently renders frame paragraphs in normal body flow. Its first
framed line begins at x=72 points in all five controls, instead of the specified
page/margin placement. Browser geometry/screenshots are retained locally under
`test-results-paragraph-frames-baseline` and `test-results-paragraph-frames-different`.
Five deliberately expected placement failures record the gap. Setup, editable
import, page count and exact package download assertions run before the failure
annotation. They are not successful frame rendering tests.

Ten unit checks verify package preservation, text edits/export/undo and native
metadata hashes/grouping. Five sources and five browser downloads pass 30 XML
schema views. No production rendering change or template completion is claimed.

Capture with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File
tools/record-paragraph-frames.ps1`. `-MetadataOnly` skips PDF export; `-Names`
can select individual controls. The default page-case PDF export remains live
at this checkpoint, with increasing CPU but no PDF. Other cases' metadata-only
captures completed and closed their owned applications. Native PDF glyph
placement and complete visual references remain missing. An observation
timeout does not prove the reference application rejects a source or that its export has failed.

The generator accepts case names as positional arguments. Regenerating a source
changes its ZIP timestamp/hash and requires recapturing its native reference.
For example, `python tools/paragraph_frames_fixture.py different` generates
only the differing-height case. Do not overwrite hash-bound controls casually.

## Expanded native controls and rejected candidate (2026-09-30)

Eight additional controls have fresh, source-hash-bound native frame metadata
and collapsed paragraph `Range.Information` page coordinates:

- `around`: rectangular wrapping with 12pt horizontal and 6pt vertical clearance.
- `not-beside`: full-width clearance, including the preceding body paragraph.
- `text-anchor`: a frame at zero offset from the following paragraph's original
  flow location; that paragraph is displaced below the 72pt frame.
- `inline`: explicit y=144pt still applies when yAlign=inline is present.
- `auto-width` and `zero-width`: omitted width and explicit zero width both
  produce the reference application's automatic-width/height API sentinel (-1).
- `aligned` and `aligned-relative`: the same center/bottom alignments with and
  without absolute x/y values. The reference application uses x/y when supplied (144,144pt); when
  omitted, it uses alignment (234,720pt). This contradicts §17.3.1.11's rule
  that alignment supersedes absolute positioning. These are original XML
  controls, not mutations of a corpus document or a fitted offset correction.

`Range.Information` coordinates describe insertion positions, not glyph ink
bounds. A native reference-application UI inspection of `margin` separately confirmed that the
frame is detached from body flow and positioned at the margin-relative offset.
The 0.05pt difference in the frame-property API is not a rendering adjustment.

A generic body-frame candidate passed 13 browser editing/placement cases and
173 scoped unit checks. It retained source offsets, grouped paragraphs,
supported wrapping, inherited style placement, auto sizing, explicit sizing,
alignment, and localized unsupported-frame fallback. Its exported packages
passed schema validation. These are candidate results, not shipped support.

The candidate was rejected by a 20-source corpus audit. Applying inherited
frame properties inside shape text initially made the style guide read-only;
excluding shape text corrected that regression. An empty framed footer in an
agenda still became read-only because its last paragraph had no following
anchor. All 20 body/table geometry comparisons matched main, but that does not
excuse losing editing. The runtime was restored to main; the candidate and
private audit artifacts are preserved locally for continued development.

Terminal frames, page-story frames, legacy cell forms, columns, drop caps and
precise full-layout fidelity remain required work. No corpus completion count
was changed. A small ordinary-body timing probe was noisy (median candidate /
main ratios 1.069, 0.899, 0.929 for 50, 200, 500 paragraphs); it does not establish
the requested absence of performance regressions.

`cell.docx` is an additional manually authored diagnostic. Its owned reference
repagination job is still live, with increasing CPU and no finished metadata.
It is not a native fidelity reference or a successful test. The two older PDF
export jobs likewise remain pending; none was restarted on an observation timeout.

The retained delivery is 26 package-preservation/native-evidence unit checks,
eight additional native references, original control sources and diagnostics.
41 source/candidate-export packages passed 123 XML schema views. No renderer
change is included, so a new production build was not required after restoring
main. GitHub Actions remains disabled; all checks were local.

## Implemented body/story frame subset (2026-10-01)

The earlier candidate rejection above is historical. The current implementation
adds terminal anchors, separates physical page-relative frames from footer flow,
and preserves legacy inline declarations as ordinary flow. Fourteen new manually
authored controls and fresh reference metadata cover terminal page/text
frames; empty and nonempty legacy inline flow in body, footer and cells;
page/text/grouped footer frames; and bordered/shaded body/footer frames.
All native references are source-hash-bound. Native UI checks of `bordered` and
`shaded` confirm detached placement and decoration over the declared 72pt height.
Insertion positions are distinct from ink bounds; no API rounding adjustment is
used. The reference application's legacy inline behavior is another divergence from §17.3.1.11's
presence-means-frame rule, independently proved by the original sources.

Source positions remain stable through edits, grouping changes, export and undo.
The final frame browser cases verify native insertion geometry and package bytes;
additional runtime tests cover hit testing/carets, cleared formatting, retained
shape text-box flows, localized body/footer recovery, decoration ownership,
physical footer border/clipping coordinates and declared-height shading.
Frame decoration extends without inflating caret line boxes. Unbordered shading
uses the frame width; bordered shading reaches the border's inner edges.

Explicit frames inside cells, frame/column combinations, section-ending anchors,
drop caps, internal page/column breaks, bidirectional/vertical placement and
multi-page frames remain open. The old explicit-cell repagination and PDF capture
jobs remain live; they were not restarted on an observation timeout. No full
native PDF paint certification or template-count promotion is claimed.

Local validation: 292 unit checks, 53 browser cases, 137 packages / 511 schema
views, production build and license checks passed. All 27 completed native
references retain their original source hashes. Actions remains disabled.
