# Performance

How Photo Studio keeps startup and everyday interactions fast, and how to
measure them. See `docs/architecture.md` ("Loading on demand") for the APIs.

## Startup bundle

Commands, tools, panels and menus register at startup, so menus, the toolbar
and shortcuts are complete from the first frame. Their implementations
(dialogs, workspaces, codecs, filters, tool behavior, panels opened from the
Window menu) load with `import()` the first time they are used. Hovering a
menu item or a toolbar slot starts loading it; files likely to be needed
next (file decoding, the New Document window, the adjustment layer editors,
transform sessions) and installed-font detection run once the workspace is
idle. Workers are separate chunks.

`npm run perf:bundle` prints every chunk and the largest modules of the
startup chunk.

Sizes as reported by `vite build` (minified; kB = 1000 bytes):

| Build | Startup chunk | gzip | JS chunks |
| --- | --- | --- | --- |
| Before | 2,359 kB | 804 kB | 37 |
| After | 1,324 kB | 443 kB | 128 |
| After, with the visual polish and QA streams merged | 1,376 kB | 460 kB | 127 |
| With the video timeline (commands and model registered eagerly; view, decoding, playback and edits on demand) | 1,396 kB | 465 kB | 133 |

Largest on-demand chunks: PSD reader/writer (two chunks, about 300 kB each),
filter operations (126 kB) and filter dialogs with Liquify and the
perspective workspaces (103 kB), pako (47 kB), adjustment editors (39 kB),
CMYK/indexed color (32 kB), GIF/BMP/PNG encoders (31 kB), the transform
session (26 kB), AI Fill/Expand (21 kB), the Layer Style dialog (20 kB), the
New Document window (20 kB), warped embedded objects (20 kB), healing tools
(18 kB), crop tools (18 kB), the main-thread style renderer (18 kB), TIFF
(17 kB). Most dialogs are a few kB.

## Startup timings

Headless Chrome, 4x CPU throttling, production build served by
`vite preview`, median of 5–7 cold runs (`npm run perf:startup`). "Shell" is
when menus, tools and panels are interactive; "ready" is when the compositor
has started (the start screen is fully live).

| | FCP | Shell | Ready | Main-thread module evaluation |
| --- | --- | --- | --- | --- |
| Before | 492 ms | 416 ms | 799 ms | 363 ms |
| After | 312 ms | 238 ms | 547 ms | 198 ms |
| After, with the polish and QA streams | 320 ms | 234 ms | 563 ms | |
| Before, 10 Mbit/s, 40 ms RTT | 1,228 ms | 1,148 ms | 1,564 ms | |
| After, 10 Mbit/s, 40 ms RTT | 764 ms | 684 ms | 1,018 ms | |
| After, with the polish and QA streams, 10 Mbit/s | 772 ms | 693 ms | 1,022 ms | |

Opening a 512 px PNG takes 165 ms to its first frame in both builds when the
file is chosen a moment after startup (the decoders are prefetched when idle,
when File → Open shows the picker and when a file is dragged in). Opened in
the same instant the workspace becomes ready, the first frame waits for the
decoders to load (about 50 ms locally, 600 ms on the throttled network).

Remaining startup work, in order: compiling the compositor's GPU pipelines
(software GPU in headless Chrome makes this look larger than on real
hardware), the first layout of the workspace, and evaluating the startup
chunk.

## Interactions

`PHOTO_PERF=1 npx playwright test tests/browser/performance.spec.ts` builds a
4000 × 3000 document with 60 layers (pixel layers, text, styles, fill layers,
groups, six embedded objects) and records the main-thread time of common
interactions, with budgets (`PHOTO_PERF_SCALE` scales them). Frame times are
not budgeted: headless Chrome renders with a software GPU.

| Median main-thread time | Before | After |
| --- | --- | --- |
| Workspace update (all panels, overlays and hooks) | 5.9 ms | 2.0 ms |
| Select a layer | 5.2 ms | 2.3 ms |
| Switch tools | 4.6 ms | 1.8 ms |
| Panels update | 3.7 ms | 0.7 ms |
| Open a menu | 0.6 ms | 0.6 ms |
| Brush stroke, per pointer move | 0.2 ms | 0.2 ms |
| Brush stroke, release and commit | 14.8 ms | 12.3 ms |
| Undo + redo | 10.7 ms | 5.0 ms |

The Layers panel used to replace its whole list on every update; with many
layers that was most of every update (tool switches, selection, edits).
It now describes one HTML fragment per row and `patchList`
(`src/ui/patch-list.ts`) keeps the elements of unchanged rows, so thumbnails
are not decoded again and only changed rows are parsed and laid out. Rulers,
the canvas overlay and the screen overlay skip rewriting identical markup.
Hooks that run on every update (frame animation sync, embedded object
refresh, Info panel previews, the Navigator) were checked: they return early
when their feature is not in use or their panel is hidden.

## Measuring

```sh
npm run perf:bundle                       # chunk sizes, startup chunk modules
npm run build && npx vite preview --port 5424 &
npm run perf:startup -- 5424 7            # add "10,40" for a throttled network
PHOTO_PERF=1 PHOTO_EDITOR_TEST_PORT=5424 npx playwright test tests/browser/performance.spec.ts
```

The editor marks `photo-studio:shell`, `photo-studio:ready` and
`photo-studio:first-document` with `performance.mark`, so the same timings
appear in the browser's performance panel.
