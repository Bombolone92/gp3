# Gradient rendering investigation

These are original black-to-white gradients with two opacity stops. The generator varies smoothness independently from first/destination-stop midpoints. Both the saved layer pixels and merged preview are magenta, so neither represents the definition's appearance. No presets, fonts, profiles or proprietary assets are used.

The optional capture tool uses [Photopea's public live messaging API](https://www.photopea.com/api/live). After loading the editor, it blocks further network requests and processes the generated files inside the browser. A paired translation forces the cached fill to regenerate. The summarizer compares every gradient descriptor class, key, value type, unit and value before accepting the pixels. It also checks that the result is a varying opaque gray field with identical rows, which rules out the deliberately stale caches.

```sh
python tests/fixtures/psd-gradient-render/generate.py /tmp/gradient-probes
node scripts/probe-gradient-reference.mjs /tmp/gradient-probes /tmp/gradient-reference
python tests/fixtures/psd-gradient-render/summarize.py /tmp/gradient-probes /tmp/gradient-reference /tmp/gradient-report.json
```

Generation and summarization require MIT-licensed psd-tools, Pillow and their usual dependencies. Recording requires the existing Playwright dependency, Chrome and initial network access. The tool runs separately from automated browser tests.

The committed report records **compatible-editor observations, not validation against other applications**. Midpoints on the first stop have no effect; destination-stop midpoints change the preceding interval. Smoothness changes the curve while keeping the stops fixed. The varying gray field proves regeneration, and exact descriptor comparisons establish that the edit preserved these tested definitions.

[Patchy's MIT-licensed interoperability notes](https://github.com/SethRobinson/Patchy/blob/4816d450e6a94e954017629745c06044186b3dec/docs/vector-tools.md) report the same midpoint behavior and a Catmull–Rom interpolation law for GdFl fills, including opacity. For a two-stop ramp with duplicated endpoints, the full-smoothness transfer is `0.5t + 1.5t² − t³`; the stored smoothness blends this with the linear ramp. This is reference evidence for implementation, not a claim that the application's renderer supports it.

Dithering, exact coordinate/quantization rules, high-depth colors, profile-relative interpolation, coincident stops, nonuniform stop spacing and shape transforms still need validation. The reference renderer's deterministic dithering hash is not an established format rule. No such approximation is added to production rendering.
