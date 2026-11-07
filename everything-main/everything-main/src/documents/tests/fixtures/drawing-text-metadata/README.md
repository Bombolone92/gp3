# Alternate drawing text with different editing metadata

`tools/drawing_text_metadata_fixture.py` manually authors this OPC/XML control
using the original alternate-frame generator and Python's standard library.
It contains no corpus content, artwork, embedded fonts or native saved output.
Both WPS/VML stories contain the same rich-text control, paragraphs and runs.
Their paragraph `rsidRDefault` values differ; only the fallback explicitly stores
an empty `sdtEndPr`. Two grouped neighbors retain ordinary rich text.

ECMA-376 Part 1 fifth edition §17.3.1.22 describes paragraph revision-session
IDs; §17.3.2.25 describes run revision-session IDs; §17.18.50 defines their
eight-digit hexadecimal type. These identify editing provenance. §17.5.2.37
defines `sdtEndPr` as end-character run properties; an empty element supplies no
properties. The supplied Part 4 `CT_SdtRun`/`CT_SdtBlock` and `CT_SdtEndPr`
schemas allow the element to be absent or contain no run properties.
This fixes application story matching, not a claimed reference/spec divergence.

The regression first failed with the original alternate-story guard. After
comparison normalization, it separately exposed fallback shells being copied
from the active story. The fix rebases paragraph/control shells onto each
equivalent branch, retaining edited text and formatting. Unit tests verify
branch-specific paragraph IDs/end-properties, rich control text, unchanged
package parts, reopen and exact undo/redo. Browser tests exercise the real
context-menu draft, Apply, Cancel, export and undo. Source and browser exports
pass both standard MCE and supported DrawingML-extension schema views.

Nonempty end properties, control identities, unknown attributes and malformed
session IDs remain significant. Differing glossary references/picture
relationships and ambiguous repeated frames remain guarded. Direct text
selection inside the displayed drawing is still separate unfinished work.
