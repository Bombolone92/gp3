# Inline objects and automatic line advancement

`tools/inline_object_advance_fixture.py` authors original XML using the original
inline-object fixture's package and black rectangle. The reference application exported
the 48-page `native.pdf` without saving changes. The recorder reads following-text
advances and object bounds directly from the PDF and records source/PDF hashes.

Controls cross four object heights (7, 20, 72 and 300pt), six automatic line
values (0, 120, 240, 278, 360 and 480), and isolated versus adjacent visible text.
Each page has a before label, the object paragraph, and an after label. This
measures paragraph advancement independently of the object's own position;
the earlier baseline controls only checked object bounds.

The reference application adds/subtracts automatic leading using text line metrics, leaving the
object's contribution to the natural line box unscaled. For compressed spacing,
the baseline also moves by the text ascent contribution (the full minimum line
height for an isolated object). Mixed text retains its descender. For example,
double spacing adds the same approximately 13.8pt after either a 20pt or 300pt
picture using this 12pt font; it does not double the picture height.

ECMA-376 Part 1 §§17.3.1.33 and 20.4.2.8 apply. The standard describes automatic
spacing in fractions of a line but does not fully specify this inline-object
allocation algorithm. These controls establish reference compatibility rather than
a demonstrated contradiction of a numeric standard rule.

Browser checks compare all 48 text advances and picture bounds within 0.15pt,
the same PDF coordinate tolerance used for existing baseline controls. Unit
coverage retains source/package/drawing properties through edit, reopen and
exact undo. Existing line-cap and rotated-line fixtures regain their one-page
reference layout without changing their tests or source files.
