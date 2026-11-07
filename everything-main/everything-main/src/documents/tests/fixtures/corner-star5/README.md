# Five-point star controls

The original generator `tools/corner_preset_fixture.py star5` builds eight
controls from our original shape-defaults shell. Cases cover defaults, inner
radius adjustments, zero, negative/excessive clamps, horizontal/vertical factors,
conflicting inner/frame dimensions, rotation and flips. Three include Arial text.
No external template artwork is included.

Geometry follows the supplied ECMA-376 Part 1
`OfficeOpenXML-DrawingMLGeometries/presetShapeDefinitions.xml`, `star5`.
The default guides are adj=19098, hf=105146 and vf=110557. The contour has five
outer and five inner vertices; the text rectangle uses the inner guide bounds.

The reference application rejected controls with only an explicit adj guide, although the
package passes schema validation. An isolated control with adj/hf/vf in that order
opened. The full fixture with all companions but hf/vf/adj order was also rejected;
the final adj/hf/vf order opens and exports successfully, including negative and
excessive adj values. The retained scratch probes distinguish these observations
from the earlier hypothesis that out-of-range adjustments caused the rejection.
These are reference import observations, not a reason to discard valid source guides.
The renderer resolves named guides with standard defaults and preserves XML.

The source opens editable in the browser, restoring the original postcard's
missing grouped artwork. That source's full edit/export/undo workflow passes.
All 4,493 independently sampled native ink locations match in the browser. Three
text origins agree within .083 pt horizontally and .148 pt vertically. 129 focused
unit tests and four browser cases pass, including rounded-corner regressions,
edit/export/reopen, unchanged shape XML and exact undo. Source/corpus/browser
exports pass schema checks; production build and license checks pass. Both pages
of the triggering original postcard were visually compared and its review is complete.

`native-reject-partial-adjustment.docx` retains the isolated schema-valid positive
adj-only control that the reference application rejected. The implementation does not reproduce this
import rejection or rewrite the user's guide list.
