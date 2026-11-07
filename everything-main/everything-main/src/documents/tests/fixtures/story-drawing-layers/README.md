# Header/footer and body drawing layers

`tools/story_drawing_layers_fixture.py` manually authors five pages of original
text and the project's original quadrant picture. The first four pages combine
both values of `behindDoc` for header and body drawings. A fifth page has no
covering body pictures and proves that header/footer content remains visible.
All pages use compatibility mode 15. Header pictures have higher stored
relative drawing orders than body pictures, deliberately testing cross-story
precedence rather than accidental numeric ordering.

The reference application exported the exact DOCX without saving it. On pages one through
four, body pictures cover header/footer text even with `behindDoc=true`.
Header pictures stay beneath body text even with `behindDoc=false`. Within the
body itself, `behindDoc=false` covers the intersecting body text and true leaves
it visible. The uncovered fifth page retains both header and footer text.

**Observed scope of the specification:** ECMA-376 Part 1 §20.4.2.3,
printed pp3102–3103, describes `behindDoc` as determining whether overlapping
document text or the drawing is on top, and its example says “above any text”.
The same clause's `relativeHeight` description (printed p3108) orders all
drawings with equal `behindDoc` by their numeric values and puts front drawings
above behind drawings. The controls deliberately give header drawings larger
values, yet the overlapping body drawing still wins, including a body-behind/
header-front combination. This documents the reference application's cross-story exception to that
global ordering. The reference application
applies the front/behind relationship within a story while painting the entire
header/footer content below the body. This original control records that
exception; the engine follows the observed native ordering without changing
the source flags or suppressing first-page headers.

The recorder binds source/PDF hashes and measures dark pixels in four fixed
text regions at 288 DPI, plus independent color samples where pictures overlap.
Covered regions must have zero dark pixels. Visible text regions allow a 20%
pixel-count difference for font rasterization; removing the text or reversing
the layer fails decisively. Body-front and body-behind variants distinguish
the two possible outcomes. No typography-fidelity claim is made by that threshold.

Browser checks repeat the comparison after undo and reopening, and verify exact
no-edit/undo package bytes and unrelated-part preservation after a body edit.
The renderer paints stories first, then the body, retaining each layer's
floating backgrounds, cells, paragraph/run backgrounds, text and foreground
drawings. Body selection and caret remain in the body/interaction layer.

Validation: 30 story/anchor unit checks and 18 browser cases pass, including
retained story tables, existing footer variants, paragraph borders/shading and
floating-picture crops. Source and control exports pass 28 XML checks; existing
regression exports pass another 55. Production build and license gate pass.
The reference application's pages 1/3 and 2/4 render identically, as expected despite the changed header
flags. The visible/covered reference pages were visually compared with the
browser output. The annual report's cover now matches the reference application's occlusion while
the next page retains its header/footer; editing, undo and reopening still pass.
