# Relative sizing with shape autofit: local read-only recovery

Generated directly as OPC/XML by `tools/relative_autofit_recovery_fixture.py`,
using original fixture helpers. No corpus content or third-party assets.

The source contains three floating text boxes with `a:spAutoFit` and
`wp14:sizeRelH` at 50% of the margin width: two in the body, on either side
of healthy content, and one in the header. A fourth, inline auto-fit drawing,
bold paragraphs and a table provide unrelated supported content.
`matched.docx` changes only the three floating boxes to `a:noAutofit`.
It is a proposed approximation control, not a native reference.

Run the app at port 5173, then:

```
node tools/probe-relative-autofit-recovery.mjs
```

This diagnostic exits 1 if recovery is broken; it is not a
passing regression test that codifies loss as the desired behavior. The matched
control must validate successfully with four decoded drawings, one table and
page stories or the diagnostic rejects the comparison.

Historical observation at `fb07b66e`: the unsupported source retained zero decoded drawings, zero tables,
and no page stories. Original package parts remain unchanged. Strict validation
throws in `fittedDrawingParagraphs()` after `validateCanvasLayout()` has assigned
four fitted assets to the package. The subsequent read-only retry receives that
already-modified state. Simply skipping the relative-size guard would therefore
not establish saved-size recovery: the scenes have already been fitted.

Recovery acceptance requires original scene/frame state, page-relative geometry,
normal fitting of unrelated drawings, full geometry/pixel comparisons and
source/editing safety. Imported WPS drawing assets have part-qualified drawing
IDs; duplicate IDs within a part are rejected rather than silently sharing a
fitted scene. Repeated page-story occurrences continue to resolve their frame at
placement time. Full native relative/autofit semantics remain separate; no
reference/spec divergence is claimed here.

Both packages pass all five applicable local schema views (ten checks total),
including the WPS and WP14 extension validation. Relevant semantics are
ECMA-376 Part 1 §21.1.2.1.4 (`spAutoFit`) and the MS-ODRAWXML `sizeRelH`
extension. Schema validity alone does not prove native layout fidelity.

## Recovery implementation

Relative-frame assets are now detected before any shape fitting. Strict layout
still rejects this unsupported sizing combination. Read-only layout retains the
affected drawing's complete authored scene, including non-autofit siblings,
while normal page-relative placement remains active. Other drawings continue to
fit normally. This is equivalent to disabling autofit only within the affected
relative drawing, not full native autofit support. The banner identifies each
such drawing and discloses possible clipping and pagination differences.

Prepared assets and layout overrides are published only after body and strict
page-story validation succeeds. A late layout exception cannot leave fitted
assets behind for the read-only retry. Unrecognized errors are not swallowed.

The added `grouped-*` pair covers mixed autofit/no-autofit children, height-only
and two-axis relative frames, and a header drawing. The original pair is byte
unchanged. Unit controls check asset identity, source preservation, unaffected
fitting and repeated preparation. Browser controls compare full page pixels and
body/story geometry at 75% and 100%, exercise both early and late failure state,
check diagnostics and disabled editing, and download the exact original bytes.
The previous failure evidence remains historical; the post-fix diagnostic is
recorded separately. No corpus template is promoted by these controls.

Local verification: 25 targeted unit checks, 22 distinct browser cases (including
native autofit, relative-frame/effect geometry, drawing fields, group text,
editing, reopening and undo), four fixture packages and 37 browser exports
passed. Production build and license checks passed. Full-page recovery pixels
match the paired controls; standalone and grouped UI screenshots were inspected.

The existing round-trip unit check exceeded its default five-second deadline
both with the changed implementation and with the unchanged baseline. All 25
checks passed with a command-line 30-second diagnostic deadline. One browser
case exceeded its default 30-second deadline during initial `page.goto`, before
opening a document; its unchanged assertions passed in an isolated run with a
120-second command-line deadline. Repository deadlines and assertions were not
relaxed. These timing observations are not a performance-equivalence proof.
