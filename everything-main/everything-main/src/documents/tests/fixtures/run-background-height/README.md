# Native run-background height controls

Original controls from `tools/run_background_height_fixture.py`; no corpus
content is included. The reference application supplies `native.pdf`.
`tools/record_run_background_height.py` independently records yellow path
bounds, text baselines and SHA-256 hashes for the source, PDF and case list.

The 28 cases cover highlights and flat run shading, Latin and explicit RTL
Hebrew text, automatic single/double spacing, exact 12/36pt spacing, minimum
12/36pt spacing, and 10pt highlighted text beside unhighlighted 30pt text.

Native behavior: exact-spaced lines fill the entire line box. Automatic and
minimum spacing use the line's shared text ascent/descent, excluding expanded
leading. A small run next to larger text receives the taller shared background.
Highlights and flat shading use the same geometry. This is native layout
behavior under ECMA-376 Part 1 sections 17.3.2.15, 17.3.2.32 and 17.3.1.33;
no new reference/spec divergence is claimed for the unspecified background bounds.

All five native/application page pairs were inspected. Browser checks compare
all 28 rectangle tops/heights within .25pt and actual painted edges within one
point. Text origins, wrapping and pagination are unchanged by the paint-only
correction. Existing editing/export tests cover ordinary highlights, shading,
inline pictures and repeated headers; rotated-cell tests exercise transformed
painting. The controls do not certify every drawing-text, marker, shifted-text
or inline-object combination. RTL editing remains guarded independently.
