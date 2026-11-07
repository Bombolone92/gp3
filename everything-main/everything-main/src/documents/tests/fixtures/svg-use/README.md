# Local SVG reuse: native references and regression controls

`tools/canvas_svg_use_fixture.py` independently authors
`public/fixtures/svg-use-pictures.docx`. It uses the existing original SVG
packaging generator: full picture, cropped picture, grouped picture and shape
fill, all retaining an intentionally different magenta PNG fallback. No corpus
artwork is included.

The reference application opened the source read-only, confirmed its
full path and exported the retained one-page `native.pdf` through
`tools/export-reference.ps1`. The full page was visually inspected.
`tools/record_svg_use_reference.py` records source/PDF hashes and native form
geometry in `reference.json`. The DOCX passes eight schema checks.

Each full vector has eight controls, read left to right:

1. A reusable rectangle inherits green from its `use` instance.
2. A blue rectangle keeps its own fill despite red on the instance.
3. A nested `use` inherits red; both translation offsets apply.
4. A half-scale rectangle retains its 16-unit source size despite `use`
   width/height of 32 (the target is not a viewport-establishing element).
5. A local rectangle referenced from a clipping path clips a larger green box.
6. A reused line inherits red and a 0.2-unit stroke.
7. The same line inherits blue in a half-scale group.
8. A reused rectangle inherits red and 0.3 fill opacity.

The SVG 2 reference is https://www.w3.org/TR/SVG2/struct.html#UseElement,
especially layout, style scoping/inheritance, and shadow-tree recursion.
These controls use SVG 1.1-compatible `xlink:href` syntax.

The reference application applies its previously documented SVG minimum pen width to *instances*:
both line controls have a 0.14-unit stroke in the exported metafile coordinates,
despite their different scale. `svg-use.js` now materializes drawable instances
only in the disposable preview so existing native-compatibility pen/text/alpha adjustments see
the instance's inherited styles and transform. Clipping references remain native
SVG `use` elements, because replacing them with `g` would invalidate the clip.

`--styles` on the generator authors `svg-use-styles.docx`; the recorder's
`--styles` option records its independent `styles-native.pdf`. Both one-page native
references were visually inspected. Its eight controls cover source ancestor
CSS, source child selectors, ID/class specificity, unnamespaced href, clipping,
inline style, percentage positions and conflicting href/xlink:href.

Two measured differences from SVG 2 are deliberate:

- The first style control remains blue: The reference application retains `.source rect` matched at
  the source, although the `.source` ancestor is outside the instance subtree.
  SVG 2 section 5.6.3 would discard that match in the shadow tree. Only specified
  declarations are retained; otherwise-inherited values still come from `use`.
- The last control is red: The reference application prefers `xlink:href="#group"` over the blue
  target selected by `href="#fixed"`. SVG 2 specifies href precedence instead.

`tests/browser/svg-use.spec.js` checks native colors/pen widths, pixel coverage,
unique IDs and local paint resources, transforms and the full editor workflow.
`tests/canvas-svg-images.test.js` checks immutable media through editing/reopen/
undo, local-reference validation, cycles and expanded element/text budgets.
The original corpus document remains partial because its Cavolini face is
unavailable; these controls do not establish complete typography for that file.
