# Full native reference shade-byte sweep — unresolved

Original controls authored directly as OOXML by the existing precision generator:

```
python tools/theme_color_precision_fixture.py --full-shades --output-dir tests/fixtures/theme-shade-sweep
```

The first two original bases, 4F81BD and C0504D, each cover every shade byte
from 00 through FF, for 512 cases. Each row contains themed text, cell shading
and a border with a deliberately wrong 112233 fallback. No corpus content or
third-party engine is used. This mode uses fixed ZIP metadata and reproduces
its source bytes; the original default generator mode is unchanged.

The reference application exported the exact source read-only to `native.pdf`
(15 pages). `tools/record_theme_boundary_colors.py` records PDF text fill colors
and SHA-256 hashes of source, cases and PDF. All 512 fresh PDF colors agree
with an earlier private reference SaveAs sweep. The reference directly measures
text, not each cell-fill or border pixel. The provenance unit test verifies
hashes, label order, RGB ranges and complete 0..255 coverage for both bases.

Run the diagnostic from the repository root:

```
node tools/check-theme-color-boundaries.mjs tests/fixtures/theme-shade-sweep
```

The current engine matches 35/512 native colors; 477 remain unresolved and the
command intentionally exits 1. This is not a passing renderer certification.
The existing 128-case precision and 128-case boundary references remain
required: matching this sweep alone would not establish tint behavior,
achromatic handling or saturated-color boundary behavior.

The source and browser no-edit/edited/undo exports pass transitional schemas.
The browser opens 15 editable pages without errors and passes exact no-edit
package retention, body editing, unrelated-part retention, exact undo and reopen.
No production color-conversion change accompanies this evidence.

ECMA-376 Part 1 section 17.3.2.6 and MS-OI29500 section 2.1.72 describe
WordprocessingML color properties and the published HSL interpretation. The sweep
addresses the unresolved precision of that conversion, not a new normative
reference/spec divergence.
