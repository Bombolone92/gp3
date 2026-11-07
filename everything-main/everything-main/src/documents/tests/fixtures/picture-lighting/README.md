# Two-point lighting and revolution

Fourteen independently authored DOCX controls use our original four-color PNG
and rectangular extrusions. `tools/picture_lighting_fixture.py` derives their
package from our existing `picture-3d.docx` control, without template content.
The reference application opened the exact source path read-only and exported
`native.pdf`; the source was not saved by the reference application. `picture_3d_reference.py
picture-lighting` records face colors, exposed side colors, and silhouettes.

Both threePt and twoPt are tested with absent rotation, 120 degrees and 270
degrees, viewed from the left and right. Two additional cases specify dir=b
with explicit zero and 120-degree rotations. These prove that explicit rotation
overrides dir, as documented by MS-OI29500 2.1.1274(b). The standard does not
specify their interaction; this is behavior documented in that published specification, not a claimed
contradiction of an explicit ECMA rule.

Preset vectors and ambient light come from MS-OI29500 2.1.1274(c), and warmMatte
parameters from 2.1.1334(b), August 18, 2026 edition:
https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/1fd4a662-8623-49c0-82f0-18fa91b413b8

The original Phong calculation matches all 84 native face/side samples within
two RGB levels. Reversing revolution fails by up to 89 levels, so the controls
distinguish rotation direction. Unit tolerance is three levels; browser tolerance
is four, accounting for raster sampling. Existing boundary-distance checks also
apply. These checks do not claim pixel-identical native antialiasing.

The controls contain no bevel. Template 109 still requires its bevel and
pagination investigation after lighting support.
