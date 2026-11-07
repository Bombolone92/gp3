# Performance follow-up — 2026-09-17

Subsequent [reader paging work](performance-reader.md) bounds long-conversation
cards and records the latest validation and remaining limits.

Baseline: `bb3990e`, including the previous paging/cache work and the missing-folder
history fix. This report covers new changes only. Raw browser measurements are in
`benchmarks/results/bb3990e-{baseline,extra}.json` and the named after files below.

## Final verification

Verified implementation: `b964a7c`. The final paired matrix served the baseline
from an isolated checkout with the same fixture/harness, followed by the unchanged
implementation. `final-baseline.json` and `final-after.json` each contain **216
completed operation records**, covering 1k/10k/100k and all ten scenarios below.
Neither contains page errors, timeouts or reset counters. History readiness
requires its completion signal, as well as transport settling. The harness rejects
page reloads; an intermediate run interrupted by development reload was discarded.

After this matrix, the visible “Loading conversation history…” notice was removed
at the user's request. History still loads in the background; `aria-busy` on the
thread exposes its pending state without adding a banner. Real failures retain
their retry action. The harness now supports both the old status and the new
busy state, and regression tests wait for completion before checking results.
The table below measures `b964a7c`, before this presentation-only follow-up.
The follow-up passed the same full unit/browser/build checks and a 1k dense/sparse
catalog smoke benchmark (`quiet-history.json`); the sparse next page still used
60 header requests and zero listings, with complete history before paging.

| Final synthetic comparison | Before → after |
| --- | ---: |
| 100k selective warm search, before history | 68 → 21 ms; zero requests both |
| 100k selective warm search, after history | 65 → 17 ms; zero requests both |
| Sparse next page after history, 1k / 10k / 100k | 139 / 139 / 126 → 101 / 101 / 100 ms |
| Requests / bytes for that page, each size | 90 / 39,210 → 60 / 30,720 |
| Ignored-limit inbox, 1k / 10k / 100k | 1,014 / 1,000 / 1,004 → 539 / 537 / 548 ms |
| 100k ignored-limit inbox JS heap | 498.5 → 44.5 MB; transferred bytes unchanged |
| 100k dense message open, cold / warm | 60 / 45 → 60 / 44 ms |
| 100k cached 8 MiB message reopen | 75 → 73 ms; zero body requests both |
| 100k abandoned folder work after switching | 318 → 0 requests in 300 ms |
| Browser long tasks across the entire matrix | 13 (843 ms total) → 0 observed |

Ordinary cold inbox work was already bounded: dense 1k/10k/100k took
109/107/104 → 109/102/107 ms with 62 requests each. Warm inbox visits used zero
requests and stayed at 50 ms. The observed peak request concurrency stayed at 12.
Injected failures recovered complete 1/10/100-result searches in the three sizes;
the 100k retry was 933 → 830 ms. Native paging, result counts and body-cache reuse
were preserved. A general cold-history speedup is **not** claimed: metadata still
has to be transferred (100k dense settling was 1,088 → 1,138 ms).

These are single runs. CPU load and GC caused variation in intermediate runs,
including near-baseline ignored-limit inbox timings. The fixed parsing bound and
eliminated listing requests are more reliable guarantees than any timing ratio.
Individual warm-open timings vary too (100k sparse: 44 → 64 ms). Heap is neither
retained app-only memory nor a universal reduction; some search snapshots grew.

Final checks: **1,034 unit tests across 63 files, 39 Chromium browser tests,
production build, and `git diff --check` passed**. Regression coverage includes
archive/delete/undo, late page completions, failure retries, complete result
pagination, keyboard focus, account isolation, and message/attachment privacy.
Changes were committed and pushed to `main` in tested increments.

## Evidence and measurement method

Reviewed the official [directory listing](https://docs.puter.com/FS/readdir/),
[file reading](https://docs.puter.com/FS/read/) and
[KV documentation](https://docs.puter.com/KV/), plus local Puter source at
`abcd58f3d0eab0369b1dedcdd0b48863c3a9b1b0`:

- `puter-js/src/modules/FileSystem/operations/readdir.js`: explicit cursors return
  one page; unbounded array calls drain pages; individual entries enter SDK cache.
- `backend/stores/fs/FSEntryStore.ts`: direct pages seek by name/id; recursive
  pages seek by path ascending and apply depth filtering. Each returned entry
  is finalized and cached. Recursive traversal is not newest-first traversal.
- `backend/controllers/fs/FSController.ts`: listings also shape entries and attach
  suggested apps; `includeTotal` adds a count query. The SDK forwards
  `no_thumbs/no_assocs/no_subdomains`, but this controller does not honor them.
  Adding those options would not establish a backend-work saving here.
- `FileSystem/operations/read.js` sends `byte_count` as a query parameter;
  `backend/controllers/fs/LegacyFSController.ts` reads HTTP `Range` instead.
  Source inspection does not establish deployed behavior. Production retains
  SDK reads; the withdrawn custom range transport is not reintroduced.
- `backend/drivers/kv/KVStoreDriver.ts` documents metered prefix scans. No new
  remote caches, KV scans, per-message writes, or indexed-query assumptions.

The existing Chromium fixture runs actual app code with synthetic 1k, 10k and
100k folders, 5 ms request latency (40 ms separately), dense days, two-message
sparse days, 8 MiB attachments, and injected failures. These are **simulations,
not signed-in Puter measurements**. Returned bytes exclude HTTP framing and real
FS metadata overhead. Backend SQL, SDK cache costs and throughput are not simulated.
Heap is a point-in-time Chromium JS estimate including fixtures, not peak memory.
Long tasks are tasks >=50 ms; history settling includes a 150 ms observation window.
Single runs are directional evidence, not statistical latency guarantees.

Reproduce with a Vite server on port 5174:

```sh
BENCH_SCENARIOS=dense,sparse,large,thread,latency,failures,coldsearch npm run benchmark -- current
BENCH_SCENARIOS=ignored-ranges,catalog-page npm run benchmark -- extra
BENCH_SCENARIOS=abandon-folder npm run benchmark -- cancel
```

## Bound header parsing when byte limits are ignored

Header enrichment now slices the returned Blob before converting it to JS bytes.
It parses at most 8 KiB, or 64 KiB for the existing oversized-header retry, even
when a server returns a whole attachment. Full reader and attachment behavior
are preserved. Regression tests cover ordinary and long headers with oversized
responses; existing ignored-range browser coverage verifies body/attachments
and warm reader caching.

| Synthetic ignored-limit case | Cold inbox before → after | JS heap before → after |
| --- | ---: | ---: |
| 1k messages | 1,006 → 539 ms | 234.4 → 20.1 MB |
| 10k messages | 981 → 529 ms | 221.6 → 20.2 MB |
| 100k messages | 989 → 529 ms | 498.1 → 44.5 MB |

Raw after data: `bounded-headers.json`. All three first pages still issue 62
requests and transfer about 503 MB when every header request returns an 8 MiB
file. No >=50 ms long tasks were observed in these inbox operations. This change
reduces parsing time/allocation, **not network bytes** or storage work. The original
response Blob and transport allocations still exist outside the parsed slice.

## Reuse complete catalogs for inbox paging

Once history/search has fetched the complete catalog, subsequent inbox pages use
those same message objects instead of listing their date folders again. The
60-message page size, descending order and native cursors remain intact. A set of
loaded names avoids rebuilding a set on each sparse-day iteration. The catalog
cursor adjusts for remove, undo and arrivals; invalidation resumes native paging.
No new remote writes, metadata cache or network protocol is introduced.

| Sparse folder: next 60 after history | Before → after |
| --- | ---: |
| 1k / 10k / 100k visible page | 136 / 142 / 135 → 98 / 103 / 101 ms |
| Requests, each size | 90 → 60 |
| Day listings / returned FS entries | 30 / 60 → 0 / 0 |
| Synthetic response bytes, each size | 39,210 → 30,720 |

Raw after data: `catalog-reuse.json`. The 60 header reads are unchanged; the
listing reduction also avoids returning/shaping/caching these 60 entries on the
backend and in the SDK. This does not claim a measured SQL-time or billing saving.
There were no >=50 ms long tasks in these page operations; the 100k heap snapshot
was 115.7 → 115.5 MB. A cold page without a complete catalog still uses native
paging. Catalogs remain complete or absent, never partially cached as complete.

## Retain subject candidates during a search

Search now constructs its candidate list during the existing cancellable,
cooperative preparation pass. Header progress and result-page navigation inspect
only those candidates, rather than repeatedly scanning every catalog entry.
Folder mutations rebuild the candidate list. Only known subject mismatches are
excluded; unknown subjects, mutable flags and dates remain eligible. Totals still
cover the full catalog, and unreadable candidates still prevent a complete claim.
Subject-only searches also avoid repeated header-read eligibility and flag work.

At 100k, the coldsearch scenario's warm selective query fell **68 → 24 ms**;
the observed 54 ms long task disappeared. After history, the same selective
query fell **67 → 23 ms**, and broad subject search **37 → 30 ms** with all
99,900 results and 60 visible rows. These warm operations use zero requests in
both versions: this is a CPU improvement, not an additional network saving.
Raw after records: `search-candidates.json`. Candidate arrays hold references
only, are scoped to one active search, and are released when the query changes.
Unit coverage specifically checks selective result counts through archive/undo;
existing tests cover retries, query changes, new arrivals and result-page focus.

## Index relationships while merging history

History merging now indexes already accepted message paths, IDs, referenced IDs
and eligible correspondents. It preserves the previous pass/discovery order and
headerless-reply fallback, including duplicate paths, conflicting references and
excluding the account's own addresses. A differential test compares 200 varied
cases against the frozen pairwise implementation, plus a 10k-message correctness
case. The existing synchronous subject prefilter is retained: adding frequent
yields increased warm-open latency without addressing an observed long task in
the baseline. Cancellation still stops subsequent catalog pages and header reads.

CPU-only Node worker benchmark (`node benchmarks/history.mjs LABEL`), using one
conversation whose messages reference a shared root:

| Candidates | Pairwise before | Indexed after |
| --- | ---: | ---: |
| 1k | 29 ms | 17 ms |
| 10k | 377 ms | 23 ms |
| 100k | exceeded 10 s; terminated, incomplete | 289 ms; complete, ordered |

These are **not visible reader timings**. Inputs are pre-enriched; there are no
network requests or DOM nodes. Raw data: `history-{before,after}.json`. Temporary
indexes trade memory for speed: the 10k heap snapshot was 10.4 → 14.9 MB; after
100k it was 90.9 MB including fixtures/results. They are discarded after the merge.
The exact pass order still permits repeated passes for unusual reverse-ordered
parent-only chains; this is not a universal linear-time history claim.

## Stop abandoned folder scans

Switching to another folder now invalidates in-flight native page work, including
scans across many empty date folders. Late root responses cannot reset a newer
listing, and stale loads cannot mark a partly enriched folder as ready. Reopening
performs a fresh load. Sign-out/shell replacement also cancels folder consumers.
Already issued SDK calls finish; generation checks prevent subsequent requests.

With 1,000 empty date folders before the first mail, the baseline issued
**354 / 336 / 336 additional listing requests** in a 300 ms observation window
after Archive was visible (1k / 10k / 100k mailboxes). After: **zero** for every
size. Those discarded empty responses were 4,248 / 4,032 / 4,032 bytes, excluding
request/framing overhead; backend directory resolution/ACL/listing work also
stops. No long tasks occurred in these windows. Raw records:
`folder-cancel-{before,after}.json`. Unit tests cover cancellation and a stale root
response after reopening; a browser test verifies requests stop and a later
reopen restores all 60 rows with accessible sender labels.

## Remaining limits

Cold complete history still needs all folder metadata, and nonselective uncached
sender/preview searches need every header. SDK requests already issued cannot be
aborted. Catalogs and enriched metadata remain O(N); reader bodies retain the
existing bounded raw-byte caches. Very long individual threads still create one
card per related message and can retain parsed reader content; broad header-only
searches still rescan current metadata
when results update. No live account performance or billing claim is made, and
no backend or SDK files were changed.
