# Native picture resize controls

These are original, textless controls derived from the independently authored
`../control.docx`; no template content or font program is included. Corresponding
XML and artwork source is `tools/retained_picture_resize_fixture.py`, with
`tools/retained_picture_native_fixture.py` removing text for native capture.
Generate a fresh source with:

```
python tools/retained_picture_native_fixture.py fresh-before.docx
```

`before.docx` SHA-256:
`f5ee56d88211c0f72238cbffdfed2653befc7a4ab7b96c83608f902d9fd45502`.
`after.docx` SHA-256:
`126c151d9d55137618b556f8f81e13a73e3d71ff0b6e23c957c7cd5935e2d77b`.
The browser test reproduces the eight edits in `changes.json`: add 18 pt width
and 5.25 pt height to unlocked fixed frames, preserve the locked frame's ratio,
and leave the active relative-width case unchanged. ZIP parts other than the
main document remain byte-identical. XML namespace declaration placement can
differ by serializer; expanded names, attributes and content must match.

The reference application captured the exact helper-opened before/after files on 2026-10-10
using `tools/capture_retained_picture_resize.ps1`. Each capture includes nine
page-range `EnhMetaFileBits` files and their SHA-256 values. Match floating native
objects by their authored names: the reference application's Shapes collection is not source order.
The tool checks unchanged source bytes, Saved state, and view settings. Both
certified captures have Saved=false before and after; they are normalized open
imports, not pristine Saved=true documents. An earlier after capture failed the
Saved-state guard and is excluded.

Native API dimensions are single-precision points, not painted ink bounds.
They confirm 118 x 65.25 pt unlocked frames and 118 x 70.80000305175781 pt locked
geometry. Relative width resolves to 153 pt. Outline width (3 pt), shadow blur
(4 pt), offsets (4.242640495300293 pt), and extrusion depth (10 pt) remain
unchanged where present. The unit test compares these to retained OOXML values.

Metafiles are page-range captures, not full-page bitmap or PDF pixel oracles.
No native resized pixel equality, perspective fidelity, effect-padding fidelity,
or full-template certification follows from these measurements. Browser tests
compare the regenerated export's reopened print pixels to the captured export's
reopened print pixels; they do not compare native reference pixels.

The export test also reproduces a real namespace-scope failure under JSDOM:
without binding unambiguous used aliases on the document root, a later relative
size element can retain an unbound `ns0` prefix. Require valid XML and successful
reopen, rather than accepting serializer differences as harmless.
