# First exit click into a restored inline prompt

The inputs are original OPC/XML, built by
`tools/empty_control_prompt_pointer_fixture.py` from the independent
`empty-control-home-end` controls. No corpus artwork or font binaries are
included. The committed inputs reproduce the exact XML/package parts used
for capture; their deterministic ZIP timestamps differ from the disposable
copies opened in the reference application. Those copies were saved over to record the outcomes.

The reference application was operated through its desktop UI on September 29, 2026,
at 100% zoom in a 946 by 536 window. Each source initially contains A, an
empty persistent rich-text SDT, then a suffix. Clicking (113,254) enters the
empty control, visibly exposing its `letters` label.

| Case | Suffix | Exit click | Replacement | Saved text |
| --- | --- | --- | --- | --- |
| tail-after | XYZ | (220,254) | Q | AQ |
| tail-interior | XYZ | (122,254) | Q | AQ |
| words-after | XYZ UVW | (220,254) | s | As |
| paragraph-after | XYZ UVW, then a second paragraph | (220,254) | Q | AQ, then Second paragraph |
| short-after | D, with the default five-space prompt | (123,254) | Q | AQ |
| runs-after | XYZ, then a separately bold UVW run | (220,254) | Q | AQ |
| break-after | XYZ, manual line break, UVW | (220,254) | Q | AQ, manual line break, UVW |
| soft-after | ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN | (220,253) | Q | AQ FOUR FIVE SIX SEVEN EIGHT NINE TEN |

For tail-interior, two Undo operations restored the original empty state
after tail-after. The remaining cases used fresh independently composed
inputs. In words-after, a Ctrl+S attempt inserted `s` into the selection;
the next save succeeded. The record intentionally uses the observed marker
and saved XML, rather than claiming the first shortcut saved the document.
The soft-after input uses Courier New 12pt and a 144pt writing width; its
original first line reads AONE TWO THREE FOUR. Entry was at (114,253).
The exit click is inside THREE, before the original visual line's end.
Every retained output was inspected on disk: there are no remaining SDTs,
and the paragraph/line boundaries survive in the appropriate cases. Hashes bind these
outputs and regenerated inputs in `reference.json`.

The selection observed after restoration spans the prompt through the end
of the word targeted before restoration. It crosses run boundaries, but
does not automatically consume the rest of the original line or paragraph.
The manual-break and automatic-wrap holdouts reject those broader rules.
The target word's end is mapped through the inserted prompt's length; the
manifest's originalSelectionEnd is inferred independently from each saved
replacement and its surviving suffix. Wrapping is not required. The old
extra-D outcome in `empty-control-pointer` is another instance of this behavior.

This applies when the physical exit click lands inside the prompt *after*
restoration. Ordinary subsequent clicks still select the prompt alone.
Clicks outside the restored prompt retain the previous pointer behavior.
ECMA-376 Part 1 17.5.2.26/31 and 17.5.2.25/39 define the SDT/content and
placeholder markup, but not mouse selection transitions. This is native
editing compatibility, not a demonstrated contradiction of OOXML.

Browser coverage uses layout-derived coordinates at two zoom levels, actual
pointer events, exact selection ranges, replacement, control removal,
retained package parts, two-step undo/redo and exported-file reopening.
Separate cases cover later ordinary clicks and read-only documents. The
unchanged viewer fails the first native range: it selects [1,360] rather
than [1,363] for tail-after. Shift-click, same-offset edge exits and broader
drag-restoration selection behavior are not established by these controls.
