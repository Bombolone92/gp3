Ten independently authored, textless controls compare blur-dependent shadow
mask sampling. Uniform black 32×32 PNGs have alpha 255 or 128. Square frame
extents are 72pt and 144pt; opaque controls use 18pt/24pt/30pt/36pt blur, and
translucent controls use 36pt. Shadows are black, fully opaque, unscaled and
displaced 216pt horizontally. No font program or corpus artwork is included.

Regenerate in a fresh destination:

```powershell
python tools/shadow_mask_antialias_fixture.py --output <fresh-directory>
```

Source and case bytes regenerate exactly. The source passes ten standard and
supported-extension schema views. This is not a rendering/equivalence certification.

The reference application emitted ten diagnostic buffers, but the capture failed its
Saved-state guard. The source disk hash remains
`bec65083bb10aa571c64337236ee33598a51d6ff9ffca5eb7281290fc440145c`.
No capture manifest was emitted, no pristine in-memory state is claimed, and
nothing was saved, closed or reset. Those raw buffers remain private diagnostic
evidence, not approved native goldens.

The preliminary results contradict a simple blur-size cutoff: 18pt and 30pt
controls match an integer box; 24pt and 36pt controls follow fractional sampling.
Padding parity plus an 8×4 box-filter hypothesis is the next global model to
validate. The retained older alpha/color controls provide the stronger,
hash-bound full-RGBA test; the new capture's state failure remains explicit.
