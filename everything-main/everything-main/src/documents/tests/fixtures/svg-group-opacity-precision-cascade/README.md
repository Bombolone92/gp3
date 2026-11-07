# Native group-opacity cascade and SVG reuse

Twenty-eight original controls distinguish presentation attributes, inline
declarations, class/ID/descendant specificity, rule order, duplicate declarations,
inheritance, percentages, calc, exponent notation and local SVG reuse. All native
RGBA bytes, origins and bounds must match exactly; no tolerance is permitted.

The native reference honors inline `inherit`, but ignores stylesheet `inherit`. Invalid
CSS opacity declarations retain the preceding numeric value or presentation
attribute. Percentages, calc, initial/unset and exponent notation are ignored in
CSS opacity declarations; numeric exponent notation works in the presentation
attribute. Percentage attributes fall back to initial opacity. These are observed
compatibility rules, not a blanket claim about CSS. The stylesheet `inherit`
behavior diverges from SVG 1.1's opacity property definition and is documented
with independent controls.

The last three cases ensure SVG use expansion retains the specified declaration's
origin and decimal precision: a stylesheet `inherit` must not acquire inline
semantics when frozen, and a transform setter must not reserialize a precise
opacity. Authored source bytes remain intact through editing, export and undo.

Generate with `python tools/svg_group_opacity_precision_fixture.py --cascade`.
Confirm the owned `control.docx` with the reference-application opening helper, capture its first
inline picture read-only, then record with `tools/record_svg_group_cubic.py
CAPTURE_FOLDER --fixture svg-group-opacity-precision-cascade`. The reference application
generated all references. The manifest binds every source/case/capture/native
reference by SHA-256. No corpus artwork, font programs or third-party document
engine is included. Dependencies: python-docx (MIT), lxml (BSD), standard library.
