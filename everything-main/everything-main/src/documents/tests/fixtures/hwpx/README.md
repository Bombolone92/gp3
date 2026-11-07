# Hanword interoperability fixtures

These files are unmodified test documents from
[neolord0/hwpxlib](https://github.com/neolord0/hwpxlib/tree/f9fd2255ac0fc57414e0b657d115e7de51d31c65/testFile/reader_writer),
commit `f9fd2255ac0fc57414e0b657d115e7de51d31c65`.
The upstream Apache-2.0 license is included as `LICENSE-hwpxlib.txt`.
No upstream implementation code is bundled.

- `SimpleEquation.hwpx`: Hanword equation script and native math conversion.
- `PageFunctions.hwpx`: page number position, restart, and page controls.
- `SimpleComboBox.hwpx`: form content and script resources in the package spine.
- `ChangeTrack.hwpx`: insert/delete markers and author metadata.
- `SimpleCompose.hwpx`: composed text stored in the `composeText` attribute.
- `SimplePicture.hwpx`: an embedded JPEG, source dimensions, floating position,
  alternative text, shadow, glow, soft edge and reflection properties.
- `SimpleContainer.hwpx`: two scaled pictures and a connecting line, with
  independent leaf transforms inside a single anchored drawing group.

The documents are used to verify format interoperability, not as reference
renders or evidence of lossless Hanword layout.
