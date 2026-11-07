# Rotated shapes in nested groups

The original XML generator replaces the pictures in this project's independent
nested-rotation package with sixteen red shapes and blue 2-point outlines. It
uses no application serializer or corpus artwork. The reference application exported the
retained eight-page PDF without changing the source. The recorder binds source
and PDF hashes and measures stable color samples and visible bounds at 288 DPI.

Controls cover arbitrary and negative angles, quarter turns, the 45-degree
boundary, each scale-axis interval endpoint, horizontal/vertical reflections,
cubic and quadratic curves extending beyond their nominal frames, and an ellipse.
Two ancestor groups have nonuniform scaling and nonzero child-coordinate origins.
The reference application exchanges scale axes in [45,135) and [225,315) degrees before rotating the
child about its scaled center, matching the previously established picture/line
compatibility behavior. The shape's outline remains 2 physical points: the first
PDF page explicitly paints the transformed paths with `2 w`, even though the
ancestor scales differ. Reflection occurs before rotation.

Browser comparisons require exact stable colors and visible bounds within 1pt,
repeated after editing, exact-package undo and reopening. Unit tests preserve
scenes and untouched parts and reject malformed rotation, group rotation and
rotated text. Rotated text and rotated groups remain unsupported. Curve bounds
transform control points before computing extrema; ellipses use transformed radii.
