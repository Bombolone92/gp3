# Rejected bounded layer-raster candidate

`rejected-candidate.patch` reconstructs seven candidate modules from main
revision `915f9d0a`. It is evidence, never production code. Seed a disposable
directory with that revision's six existing `src/engine` modules named in the
patch, then apply the patch there. Keep the normal Vite server running the
unchanged repository on `0.0.0.0:5173`.

From the repository run:

```
node tools/probe-svg-compositing-cache.mjs <disposable-dir>/src/engine <output.json>
npx vitest run tests/svg-flat-compositing.test.js
```

The probe reads the two independent native fixtures already in the repository
and serves only the candidate modules through Playwright request routes. It
does not install code in the app or change the current browser tab. It measures
72 flat interior colors, forced-completion painting, cache hits/misses and
release on close. It does not prove arbitrary transform, clipping, antialias,
edit/export or corpus fidelity. Failure of the performance gate stopped that
validation. Existing native expected-failure browser oracles remain unchanged.

The candidate incorporates the rejected vector precision patch with a bounded
4 MP global raster cache and exact transform keys. All 72 colors match, but
painting remains much slower despite cache hits. Do not revive this candidate
or the earlier direct-path approach as a rendering fix without new evidence.

The evidence JSON records raw tested module hashes. The patch normalizes their
line endings to LF; compare normalized text when reconstructing the candidate.
No source artwork or proprietary native reference is added here.
