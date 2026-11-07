# Original outer-shadow controls

`tools/picture_shadow_fixture.py` creates twenty independent pages from the
project's original transparent picture texture. No template artwork is copied.
Every frame is 144 by 144 points, at page position (72, 100). Controls isolate
zero/four/twelve-point blur, offset direction, backing fill, ellipse clipping,
picture alpha, front/perspective 3D, colored shadows and the `a14:shadowObscured` extension. One case combines a small
vertical offset with the blur radius encountered during source-109 review.

The reference application opened the exact source path read-only and exported
`native.pdf`. The source passes eight XML schema checks, including validation of
five shadow-obscuration declarations. The full initial sixteen-page contact
sheet was inspected; the added default-value case was checked against explicit
false by exact RGB comparison of the picture/shadow region.

Run `tools/picture_shadow_reference.py` after native export. It verifies all
page labels, records source/PDF hashes, extracts six color samples and four edge
profiles per page at 288 DPI, and records native PDF image dimensions. Four
independent picture-region comparisons are pixel-identical:

- Absent extension and explicit false.
- Explicit true with absent fill and explicit noFill.
- Absent extension and explicit noFill plus false.
- Empty extension element and explicit false.

True and false differ visibly: true suppresses shadow behind the picture's
transparent portions. Do not infer the empty element's behavior from the 2012
MS-ODRAWXML excerpt, which listed default 1. The
[current published MS-ODRAWXML schema](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/869af0ef-665b-4f28-a596-0917474ede26)
specifies default false, matching these native controls. The
[extension definition](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/ee983459-9592-43f9-b312-9e66f3a89fc5)
describes shadow obscuration for shapes with no fill. No divergence from the
current specification is established.

ECMA-376 Part 1 §20.1.8.45 (printed pp. 2874–2875) defines blur radius,
alignment, offset direction/distance, scale, skew and rotation behavior. It does
not specify the exact PDF rasterization used by the reference application. For these fixed frames,
the native sharp, four-point and twelve-point shadows are exported as 401×401,
212×212 and 93×93 pixel images respectively. Edge profiles therefore include
the reference application's raster sampling as well as blur. Do not turn these three observed bitmap
sizes or a Gaussian fit into a normative rendering formula.

The engine now supports unscaled/unskewed outer shadows on standalone pictures,
including the existing supported 3D subset. Texture alpha supplies the ordinary
shadow mask. With shadowObscured=true, the full shape silhouette supplies the
mask and the shape's interior is removed from the shadow before painting the
picture. This distinction is visible outside a translucent picture too; merely
clipping a texture-alpha shadow produces an incorrectly faint exterior.

Browser checks compare four interior colors and external shadow profiles through
editing and reopening. Profiles allow one native PDF shadow texel plus half a
CSS pixel of position uncertainty, with at most three RGB levels of color error
against interpolated native samples. The one-CSS-pixel picture-coverage fringe
is excluded from shadow-profile assertions; existing picture/3D controls check
foreground geometry. This is not a pixel-identity certification. Native blur
profiles support interpreting the radius as three Gaussian standard deviations;
the exact low-resolution PDF sampling is not copied into the engine.

Grouped shadows, rotated frames, scaled/skewed shadows, combined effect lists,
and obscuration on custom or perspective geometry remain guarded. Source 109
still needs its lighting, bevel and pagination work.
