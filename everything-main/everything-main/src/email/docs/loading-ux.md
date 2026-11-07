# Loading and transition improvements — 2026-09-17

Implemented in tested increments starting from `9de4d91`, followed by the
user-requested 500 ms spinner threshold.

## Behavior

- Startup, folder loads and message bodies use static skeletons. They reserve
  space immediately but become visible only after 180 ms. These views retain
  the skeleton alone for longer waits; no spinner is layered on top.
  Completion removes the node and its CSS delay; there are no loading timers
  to fire after navigation.
  Account-check steps reuse the startup placeholder instead of restarting it.
- Refresh, send, delete and attachment icons stay stationary for the first
  500 ms, then give way to a spinner in the same space. Paging retains its
  label and reserves space for a delayed spinner. Disabled controls and
  `aria-busy` expose pending operations; loading
  regions have accessible status text and decorative shapes hidden from AT.
- Header reads no longer rewrite the toolbar count for every message. Search
  progress is delayed, and an incomplete search with no matches uses a skeleton
  until a definitive empty result or a failure is available. Partial results
  and retry behavior remain available.
- Native system fonts eliminate the late external font swap and font requests.
  Mobile rows reserve their preview line while metadata arrives.
- The reader uses known recipients and dates immediately and reserves the
  message-menu space, keeping the tested header positions unchanged when body
  loading completes. That menu has a 44 px target for coarse pointers.
- Attachment chips show known sizes immediately.
  Unknown-size read labels use the same short reveal delay. Completion preserves
  chip identity and keyboard focus on Remove.
- Refresh reconciles rows without detaching the existing list. Keyboard focus
  and scroll position survive completion in both conversation modes. Reused
  unthreaded rows hydrate cached sender, preview and date before repainting;
  missing headers re-enter the bounded visibility queue so a failed read can
  recover on refresh.
- Unthreaded rows retain their subject while unknown sender/date values use
  static shapes after 180 ms. They expose a busy state and an accessible
  loading description instead of an ellipsis or a temporary directory date.
  Completion preserves row size, subject position and focus in both densities
  on desktop and mobile; cached rows bypass these placeholders.

## Verification

| Requirement | Evidence |
| --- | --- |
| No brief spinner flashes | CSS delays visibility and rotation until 500 ms; boundary tests check 499/500 ms, quick completion and removal |
| Smooth loading and transitions | Browser checks hold listing/header/body reads, verify static skeletons, unchanged reader header bounding boxes and refresh row positions, and cancellation after folder navigation |
| Accessible feedback and motion | Named status regions, hidden decorative shapes, busy control attributes, no running skeleton animations under reduced motion, touch-menu sizing and keyboard-focus checks |
| Preserve mail behavior | 1,042 unit tests across 64 files; 61 Chromium browser tests; production build and whitespace check |
| Preserve performance bounds | Existing bounded-read regression tests and 48 synthetic operation records across 1k/10k/100k folders at 5 ms and 40 ms transport latency |

Desktop/light and mobile/dark skeleton screenshots, plus desktop and touch
reader screenshots, were rendered and visually inspected. The browser suite
covers composing, drafts and attachments, reply delivery, archive/delete,
search failures and retry, paging focus, privacy, long conversations and print.
The new tests live in `tests/browser/loading.spec.js` and
`tests/browser/search.spec.js`; attachment stability is also covered in
`tests/composedialog.test.js`.

The refresh regressions were reproduced before the fix: conversation rows lost
focus, and unthreaded rows regressed to an ellipsis, no preview and a directory
date. Browser tests now verify unchanged row text, identity, scroll position,
focus and header request counts across refresh, with no removal of the focused
row or its ancestors. A separate failure/retry check covers uncached headers.
Unthreaded pending-row screenshots were also inspected in desktop/light and
mobile/dark modes; both default and compact density pass the geometry checks.

The performance smoke run before the delayed-spinner follow-up is recorded in
`benchmarks/results/ui-loading.json`. All 48 operations completed without page
errors, timeouts or observed tasks of 50 ms or longer. Cold inboxes retained
60 rows, 60 header reads and 62 total requests at every size; warm folder visits
used zero requests. Peak request concurrency remained 12. These are synthetic
Chromium checks, not signed-in Puter latency measurements or a paired speedup
claim. No SDK, transport or storage protocol changed.

The final repeat after the refresh and unthreaded-row fixes is recorded in
`benchmarks/results/ui-refresh.json`: all 48 operations completed without
errors, timeouts or observed long tasks. Cold inboxes still used 60 header
reads and 62 requests, warm folder visits used zero requests, and peak request
concurrency remained 12 at all three sizes and both simulated latencies.

The 500 ms spinner threshold follows the user's timing preference; it is an
app-specific choice, not a universal UX cutoff. [Carbon's inline-loading
guidance](https://carbondesignsystem.com/components/inline-loading/usage/)
distinguishes contextual action feedback from skeletons for loading content.
Content skeletons and action spinners are separate loading treatments.
The skeletons remain static, and reduced-motion mode retains the action
spinner's 500 ms reveal while disabling rotation. Icons and skeleton shapes retain their
geometry throughout. Attachment repaints keep the icon container so another
file completing cannot restart a pending spinner's delay.

Reproduce with:

```sh
npm test
npm run test:browser
npm run build
git diff --check
# With Vite running on port 5174:
BENCH_SIZES=1000,10000,100000 BENCH_SCENARIOS=dense,latency npm run benchmark -- ui-loading
# Repeat against the final refresh changes (use BENCH_URL for a different port):
BENCH_SIZES=1000,10000,100000 BENCH_SCENARIOS=dense,latency npm run benchmark -- ui-refresh
```
