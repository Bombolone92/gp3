# Puter Mail performance verification — 2026-09-17

Baseline: `042ff95`. Improvements build on its existing 60-message pages,
descending name cursors, recursive catalogs, deduplication, and bounded body cache.
Only this app was changed; no Puter backend or SDK changes are required.

## Update: sorted recursive inbox pages

With recursive `sortBy`/`sortOrder` now supported, inbox loading uses descending
filename cursors with `recursive: true` and `depth: 2`. UUIDv7 filenames sort by
arrival time. The initial root listing still detects older array-only SDKs and
estimates directory overhead. The first recursive page allows for those directory
entries plus 60 messages (capped at 1,000 entries); later pages request 60 entries.
Only 60 messages per UI batch receive header reads. Extra entries are buffered,
and arrivals use an independent cursor that stops at the newest known filename.

If the root listing itself has another cursor page, the app keeps walking recent
dates: global name sorting would otherwise scan thousands of date directories
before reaching messages. Older SDKs keep the existing array traversal.

Synthetic request-count comparison against `c23dcc3`, using the updated keyset
filesystem fixture (first 60 messages / next 60 / no-arrival check):

| Mailbox | Before | After |
| --- | --- | --- |
| 1,000 messages in one day | 2 / 1 / 2 | 2 / 1 / 1 |
| Two messages/day, 60 days | 31 / 30 / 2 | 2 / 1 / 1 |
| Two messages/day, 365 days | 31 / 30 / 2 | 2 / 1 / 1 |
| Two messages/day, 1,500 days | 31 / 30 / 2 | 31 / 30 / 2 |

This trades repeated day requests for an extra copy of the date-directory
metadata: the 60-day fixture returns 180 initial entries instead of 120. These
are synthetic request counts, not measured production latency. The historical
recursive-path-order limitation and measurements below predate this update.

## What changed

- **Recovery:** custom HTTP Range reads and the 64 KiB reader preview were
  withdrawn in `670618a` after the user reported deployed loading failures and
  repeated attachment transfers. Production uses `puter.fs` directly again.
  Source contracts and mocked fetch tests had not established live compatibility.
  The preview also failed to cache a complete oversized response when a server
  ignored its requested limit. Full reader loads now use the bounded body cache.
- The latest message expands automatically. Up to five recent unread messages
  also expand only when their complete bytes are already cached; older uncached
  bodies and their attachments are fetched only when explicitly opened.
  EOF-proven short header reads can satisfy a full reader load without a second
  request. Opening larger messages still downloads the complete MIME file.
- MIME boundaries are found directly in bytes; part bodies are views, avoiding
  repeated whole-attachment string conversions and copies. Existing encoding,
  binary attachment, HTML isolation, and privacy tests still pass.
- Subject constraints eliminate impossible header reads before sender/preview
  searches. Missing subjects are not pruned; neither are mutable flags or dates
  whose header value can differ from the filing day. Capped cached recipients and
  oversized headers cannot silently establish a complete search.
- Complete search results use **60-row pages** with keyboard focus and reader
  navigation across pages. Folder rendering uses **300-row windows** with access
  to all earlier loaded messages. Removed search DOM is released, not just hidden.
- Catalog consumers share work and can cancel independently. When the last leaves,
  no more pages are scheduled. Folder/header workers stop when obsolete; the index
  queue uses an offset instead of shifting 100k entries. Catalog invalidation
  retries are bounded. History failures remain visible with a Retry control.
- File reads share a **12-request** ceiling, with reader work prioritized over
  queued header indexing. Search has six workers. Raw byte caches have independent
  limits: 16 MiB/32 full bodies and 1 MiB/128 small complete messages. The account-scoped local header index retains its existing 4k cap.
  No KV scans, new remote cache writes, or whole-mailbox remote rewrites were added.

## API and backend evidence

Reviewed official [readdir](https://docs.puter.com/FS/readdir/),
[read](https://docs.puter.com/FS/read/), and [KV list](https://docs.puter.com/KV/list/),
plus local Puter checkout `abcd58f3d0eab0369b1dedcdd0b48863c3a9b1b0`:

- SDK `FileSystem/operations/{readdir,read}.js`: cursor envelopes make one request;
  array calls drain pages; entries enter the SDK cache; reads send count in the URL.
- `FSEntryStore.ts`: direct pages seek by name/id; recursive pages seek by **path
  ascending**, with prefix/depth filtering and `limit + 1`. Recursive sort options
  do not yield newest-first history. Returned entries also incur cache finalization.
- `FSController.ts`: per-entry shaping remains; `includeTotal` adds a count query.
  The app retains native pages, recursive depth 2, and avoids total-count requests.
- `LegacyFSController.read` passes HTTP Range to storage/S3, ignoring `byte_count`;
  `mcp-connector/src/tools.js` documents the mismatch. This is **local source
  evidence, not proof of the deployed backend revision or browser compatibility**.
- `KVStoreDriver.ts`: list is a metered scan. No new KV scans, secondary-index
  assumptions, remote cache writes, or mailbox rewrites were introduced.

## Measurements and reproduction

Browser fixtures use synthetic 1k, 10k, and 100k mailboxes. Dense means up to
10k messages/day; sparse means two/day (up to 50k synthetic date folders).
Small messages are 512 bytes; attachment-heavy messages are 8 MiB. The default
transport adds 5 ms/request, with a separate 40 ms latency scenario and injected
listing failures/recovery. It models documented/native cursor semantics and
honored ranges; it does **not** simulate DynamoDB, S3 billing, SDK per-item caching,
real metadata payload sizes, or production network throughput.

Timings are Chromium measurements of the actual app, including automation and
rendering overhead, not projected live timings. Bytes are synthetic response
payload bytes, excluding HTTP framing. `longTasks` records browser tasks ≥50 ms;
heap snapshots are Chromium JS heap estimates including fixture data, not total
process memory or peaks. `nodes`/`rows` count attached DOM. History settling includes
a 150 ms idle observation window. The targeted subject/sender query follows
history loading, so matching headers may already be warm; its first run still
exposes the baseline's unnecessary reads of all other messages. Timeout and
interruption records are incomplete measurements, not completed results.

Run a development server on port 5174, then:

```sh
npm run benchmark -- after
npm run benchmark:range
BENCH_SCENARIOS=latency,failures,coldsearch npm run benchmark -- conditions
```

Use `BENCH_URL`, `BENCH_SIZES`, `BENCH_SCENARIOS`, `BENCH_TIMEOUT`, and
`BENCH_BROAD_TIMEOUT` to select a server/matrix/deadline. For a before comparison,
serve baseline `042ff95` from an isolated checkout with the same `benchmarks/`
fixture files and use its URL. Broad-search deadlines close an unresponsive
renderer rather than allowing the benchmark to consume resources indefinitely.

The separate range benchmark performs real loopback HTTP against a synthetic
server implementing the inspected `/read` contract. It compares SDK-style query
parameters with the withdrawn experimental Range transport, now confined to
`benchmarks/range-transport.js`. It is not a production app improvement or a
deployed Puter measurement.

## Before/after browser results

One run per case on this machine, at 5 ms synthetic latency; not medians or live
Puter measurements. Before is `042ff95`; after uses the recovered SDK/full-reader
path from `670618a` (unused preview-cache cleanup does not change these workloads).
Raw per-operation request/byte/long-task/heap records are in
`benchmarks/results/{before-final,before-100k,after-recovery}.json`.

| Synthetic case | Before | After |
| --- | ---: | ---: |
| 1k dense inbox, cold / warm | 120 / 51 ms | 121 / 50 ms |
| 10k dense inbox, cold | 102 ms, 62 requests | 102 ms, 62 requests |
| 100k dense inbox, cold | 108 ms, 62 requests | 103 ms, 62 requests |
| 100k sparse inbox, cold | 112 ms, 91 requests | 106 ms, 91 requests |
| 1k, 8 MiB message open, cold / warm | 847 / 820 ms | 113 / 74 ms |
| Same cold open, long-task time | 777 ms | 0 ms |
| Same cold open, JS heap snapshot | 148.1 MB | 26.9 MB |
| 10k broad subject search | 2,281 ms, 9,990 DOM rows | 17 ms, 60 DOM rows |
| 100k broad subject search, sparse | exceeded 20 s, incomplete | 45 ms, 60 rows, 99,900 results |
| 100k targeted subject/sender, before history | 125,671 ms, 100,041 requests, 65.50 MB | 1,015 ms, 200 requests, 14.38 MB |
| 100k targeted subject/sender, after history | 129,531 ms, 99,841 reads, 51.1 MB | 93 ms, zero reads/bytes |
| 100k dense history settling | 1,088 ms | 1,155 ms |
| 100k sparse history settling | 1,472 ms | 1,320 ms |

The targeted after-history result avoids unrelated messages; matching headers
were already read by history. It is **not** a fresh-mailbox zero-read search claim.
The separate `coldsearch` scenario measures that first-use case before history:
99 additional matching-message headers after, versus 99,940 before. The remaining
101 requests list the complete catalog; the full 100 results are preserved.
Search remains complete; rendering only 60 rows does not truncate the results.

Inbox work was already bounded and shows little change. History still transfers
all folder metadata: dense cold open plus history transferred about 14.38 MB both
before and after. The MIME change reduces CPU/memory, **not attachment bytes**:
the 1k large-message cold open transfers the same 8,528,772 synthetic bytes in both
versions. Warm reopen transfers zero body bytes while the full message fits in
cache. A retained 100k targeted-query long task of 69–86 ms shows that metadata
filtering/grouping is still a responsiveness limit.

The baseline 100k dense broad search was manually interrupted after it became
unresponsive; no reliable completed timing was recorded. Sparse/large baseline
broad searches hit the explicit 20-second deadline. Neither is a successful result.
Heap figures include fixtures and garbage-collection effects; they are not peak
or retained app-only memory, and not every after snapshot is smaller.

## Avoiding automatic attachment-heavy history downloads

A follow-up compares recovered commit `d347052` with the cached-only automatic
expansion change. The fixture contains a 20-message unread conversation, each
message carrying an 8 MiB attachment-heavy MIME file, within 1k/10k/100k mailboxes.
Both runs use the same fixture and 5 ms synthetic latency. All 20 cards remain
available; opening an older folded card by keyboard loads its complete message.
Small unread messages already held by the EOF cache retain automatic expansion.

| Mailbox | Cold visible open, before → after | Full body downloads | Warm visible open |
| --- | ---: | ---: | ---: |
| 1k | 196 → 85 ms | 5 → 1 | 74 → 69 ms |
| 10k | 207 → 118 ms | 5 → 1 | 71 → 68 ms |
| 100k | 190 → 83 ms | 5 → 1 | 74 → 70 ms |

Body payload falls from 41,943,095 to 8,388,619 bytes (80%) in every cold case.
Warm opens use zero body requests in both versions. At 1k, total cold-open bytes
including concurrent catalog work fall from 42,083,636 to 8,529,160; the JS heap
snapshot falls from 59.8 to 29.4 MB. Both versions record no ≥50 ms long tasks
for these opens. Other timings/metadata work vary; raw records are in
`benchmarks/results/{before-thread,after-thread}.json`. Reproduce with
`BENCH_SCENARIOS=thread npm run benchmark -- thread`.

This reduces automatic **body** downloads. It does not establish that live SDK
header limits are honored, or eliminate attachments embedded in the selected
message. The byte-transfer assumptions and live-verification limitation above
still apply.

## Remaining limits

- Complete uncached sender/recipient/preview searches without a selective subject
  still require O(N) header reads. `body:` searches the existing preview field,
  not full message bodies. Results and failures remain explicitly labeled.
- Cold conversation history still needs complete Inbox/Sent/Archive catalogs:
  recursive pagination reduces round trips, not the number of metadata entries.
  Catalogs/results and loaded message metadata remain O(N) memory; they are not a
  constant-memory or disk-backed mail index. Exceptionally long single threads
  also retain one card per related message. These remain follow-up work.
- The server stores one MIME file per message, without a part-offset index.
  Opening large mail still transfers the entire MIME file. The SDK byte-limit
  request may also transfer full files on a backend that ignores it. Messages
  larger than the 16 MiB body-cache budget are not retained, so reopening those
  downloads them again. Lazy attachment transfer remains unresolved.
- Already issued SDK listings cannot be aborted by this SDK interface; cancellation
  stops subsequent work. SDK read requests also cannot be aborted by the app.
  There are no production custom range requests; authentication and retries
  retain the SDK path.
- The older array-only SDK fallback necessarily transfers full directory listings.
  Persistent header-cache eviction means warm performance above 4k cached headers
  is not equivalent to a persistent full-mailbox index. Live deployment, bandwidth,
  billing, and very large genuine conversations still need account-based validation.

## Recovery and live verification status

The custom transport was shipped after source inspection and mocked tests,
without sufficient live verification. After reported loading failures, `670618a`
restored SDK reads and full-reader caching. `845ed8e` removed the unused preview
cache and moved the range experiment out of production. The recovery bundle was
confirmed on the supplied Amplify URL: SDK wiring present, withdrawn code absent.

**Signed-in reproduction is pending:** browser discovery returned no connected
sessions; the user was asked to connect one. No account mail was accessed. An
unauthenticated API probe returned 401 and no exposed Content-Range header; this
is a compatibility concern, not proof of the signed-in failure's cause.

Final local validation: **1,017 unit tests (62 files), 37 browser tests, production
build, and `git diff --check` passed** on the recovered implementation. The added regression exercises a server that
ignores byte limits, checks that mail body/attachment names render correctly, and
checks that reopening a cacheable 8 MiB message does not perform another full
read. The experimental range transport is kept only under `benchmarks/` for
reproducing the source-contract comparison; it is not imported by production.

At 40 ms synthetic latency and 100k messages, cold inbox is 319 ms in both runs;
reader visibility is 110 → 60 ms and cold-history settling is 4,853 → 4,903 ms.
Injected catalog failures show Search unavailable in both versions and recover
complete 100-result searches on retry (845 → 863 ms). The after retry renders
60 rows per page. No live latency, billing, server CPU, or authenticated bytes
measurement is claimed. See `before-conditions.json` and `after-conditions.json`.
