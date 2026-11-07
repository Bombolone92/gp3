# Retained standalone picture resizing

`tools/retained_picture_resize_fixture.py` constructs nine independent controls
from original XML and artwork. No user-template content is included. Cases cover
ellipse and freeform Bézier clipping, crop/reflection, a physical outline,
backing fill, an outer shadow, front orthographic 3D, distinct inner/outer extents,
an active aspect lock and protected percentage sizing. The ellipse carries
inactive extension size placeholders whose namespace is declared ignorable by its
document ancestor.

Relevant provisions are ECMA-376 Part 1 §§20.1.2.2.19/31 (aspect locks),
§20.1.7.6 (transform), §20.1.8 (geometry, fills and effects), §20.2 (pictures),
§§20.4.2.3/6/7/8 (positioning and frame/effect extents); Part 3 §7.2 supplies
inherited namespace-scoped `mc:Ignorable`. MS-ODRAWXML §2.18.3 describes the
relative-size declarations. Inactive zero placeholders use the existing
standard-extent fallback; active percentage sizing remains protected.

Resizing rewrites frame extents and scales existing inner extents by their
original ratios. It rebuilds the retained scene through the strict reader,
preserving source path coordinates, crop/reflection, physical outline/effect
parameters and 3D properties. Export retains the vector drawing and original
media rather than embedding the session preview. Internal appearance editing,
actual drawing groups and percentage-size editing are outside this feature.

Browser checks exercise pointer resizing, exact package-part undo, exported and
reopened dimensions, identical live/reopened print pixels, unchanged semantic
appearance XML, asynchronous cancellation and the size-only properties dialog.
Unit checks exercise repeated editing with compatibility declarations on an
ancestor and a namespace alias, reject nonignorable declarations and enforce
read-only, aspect and dimension guards. The inherited-context control failed
before the context fix with `unsupported inline sizeRelH`.

These controls establish editing and round-trip behavior. The subsequent
[textless native captures](native/README.md) confirm frame dimensions, locks and
physical effect properties before and after resizing. Native pixel comparisons
of perspective/size-dependent effect padding and arbitrary source geometry
remain necessary; unchanged effect parameters do not prove every native halo or
pagination result.
