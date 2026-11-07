Eight independently authored textless controls distinguish initial coverage
rounding. Each uses a 72pt square with a black 32-by-32 image, a 48pt black
100%-opaque outer shadow, and a 216pt horizontal displacement. Image alpha
values are 1/63/65/127/129/191/193/255; none is a multiple of 32. No source
artwork or font program is included.

Regenerate into a fresh directory with:

```powershell
python tools/shadow_mask_precision_fixture.py --output <fresh-directory>
```

The reference application emitted eight diagnostic buffers, but capture failed the Saved-state
guard. Source bytes remain unchanged, with SHA256
`2302d9fa17fca6428b47d48a16f564fed104084dcb46669e5c31845cb88f1fab`.
No capture manifest was emitted; no pristine in-memory state is claimed.
Nothing was saved, closed or reset. Raw buffers remain private diagnostic
evidence, not approved native goldens.

With one fixed sampling/kernel/brush model, nearest-byte initial coverage
matches all eight diagnostic buffers. Flooring and retaining fractions match
none. The older alpha-64/128/192 controls cannot distinguish these stages.
This does not certify the textured-image pipeline or original #128.
