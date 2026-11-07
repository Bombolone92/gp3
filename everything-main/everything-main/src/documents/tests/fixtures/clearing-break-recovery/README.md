# Text-clearing-break recovery controls

`tools/clearing_break_recovery_fixture.py` generates twelve original packages
using standard-library XML/ZIP construction and the locally authored PNG helper.
No corpus artwork or third-party document engine is included.

Each document has a rich hyperlink in the body, a table cell, the header and the
footer. A bold, colored 14-point run contains both text and an inline picture;
another italic run follows inside the same hyperlink. The `before`, `after` and
`both` variants put line breaks before, after or on both sides of that picture.
Each position has `clear=left`, `right`, `all` and a matched `none` control.
Styles, numbering, paragraph indentation and page dimensions remain identical.

At baseline `4fb03a0d`, a valid clearing break rejects the entire run and then
rolls back its containing hyperlink. All four pictures disappear, along with
supported rich formatting and active link destinations. Both browser zoom checks
fail with zero retained pictures instead of four; nine unit cases fail.

ECMA-376 Part 1 §17.3.3.1 (`br`) and §17.18.3 (`ST_BrClear`) define clearance
around floating objects. It is not merely an ordinary line break when a float
interrupts the relevant text region. The initial **read-only approximation** retains
the ordinary line break and reports the omitted clearance with the source part.
It does not implement float-clearing layout, enable editing of that unsupported
feature, or alter the source declarations. Invalid clearing values remain
unsupported. Page/column breaks keep their existing handling: the specification
says that `clear` is ignored on those break types.

The paired fixtures deliberately use inline pictures. Their geometry/pixel
comparison proves preservation of supported content under the stated
approximation; it does not prove correct clearance around floats. Full float
clearing remains open under L09 in the compatibility backlog. No reference/spec divergence
is claimed.

Unit checks cover strict rejection, local recovery, links, formatting, breaks,
package preservation and the read-only export guard. Browser checks compare all
page pixels and body/story line geometry to the corresponding `none` control at
100% and 75%, check the keyboard-accessible feature details and blocked editing,
and download every unsupported variant as the exact original bytes. All twelve
sources pass sixty standard schema views.

As of 2026-10-03, valid clearing breaks remain editable and preserve their
clearance through typing, formatting and export. The current tests check editing,
exact undo and package-part identity instead of blocked editing. All inline-only
controls still match their ordinary-break counterparts at both zoom levels.
Native square-float clearance controls and supported scope are documented in
[clearing-break-wrapping](../clearing-break-wrapping/README.md). The preceding
paragraphs describe the original recovery milestone, not the current guard.
