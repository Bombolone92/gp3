# Ellipse pictures

Original OPC/XML controls reuse this project's own floating-picture-crop artwork,
with eight floating ellipses covering positive/negative source crop, both flips,
duotone and alpha. A ninth control is an inline grayscale ellipse. The generator
does not use the application serializer. The reference application exported two pages;
the recorder binds source/PDF hashes and samples stable inside/outside pixels,
excluding the antialiased ellipse boundary. Alpha composition permits the same
three-channel-level PDF/canvas rounding allowance as the earlier crop controls.

ECMA-376 Part 1 §20.1.9.18 and §20.1.10.56 define preset geometry and ellipse.
The importer retains the existing ellipse path representation and picture scene;
no new rasterizer is used. Nested pictures resolve their texture separately from
the parent-owned clip path. Adjusted ellipses and unsupported standalone rotation
remain guarded. Existing 3D picture handling is unchanged. Editing retains the
original picture XML/media; undo restores every original OPC part.

No reference/spec divergence was found. Browser comparisons cover all nine controls
before and after editing, undo and reopening. Nested clipping has a structural
unit regression; this fixture does not certify every grouped transform visually.
