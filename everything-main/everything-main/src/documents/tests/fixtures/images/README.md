# Independent vector interoperability fixtures

Unmodified samples from [tbluemel/rtf.js](https://github.com/tbluemel/rtf.js)
at commit `85fddf55b2f262bfd450769120c18c9ccef1f21c`:

- `car.wmf`: `test/wmf-test-files/car-1/source.wmf`; a placeable vector car
  drawing with an alignment word after META_EOF.
- `drawing.emf`: `test/emf-test-files/image-6/source.emf`; a vector drawing
  exercising native EMF record parsing and SVG rendering.

The upstream MIT license is included in `LICENSE-rtfjs.txt`.
These verify interoperability with independently authored files. Successful
decoding does not establish support for all Windows GDI/EMF+ operations.
