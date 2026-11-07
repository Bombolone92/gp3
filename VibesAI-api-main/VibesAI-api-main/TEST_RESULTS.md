# Test Results — vibes-api client

This file documents the live API tests performed against vibes.ai using
the `meta_session` cookie provided on 2026-07-15.

## Summary

✅ **End-to-end video generation succeeded** — see `test-output/fixed_test.mp4`
(6.7 MB MP4, 1280×720, generated from the prompt *"A drone shot of waves
crashing on a rocky coastline at golden hour"*).

The Python client `VibesClient` was tested feature-by-feature against the
live API. All major flows work; TTS has a documented backend-token caveat.

## Per-feature results

| # | Feature | Method | Result | Notes |
|---|---|---|---|---|
| 1 | User profile | `get_me()` | ✅ | Returns full user object including `username`, `id`, `accountStatus` |
| 2 | List projects | `list_projects()` | ✅ | Returns paginated project list |
| 3 | Create project | `create_project()` | ✅ | Returns new project with composition shell |
| 4 | Image generation | `generate_image()` | ✅ | Synchronous. 1280×720 image returned immediately |
| 5 | Prompt enhancement | `enhance_prompt()` | ✅ | Returns 4 variations each with image+video prompts |
| 6 | TTS voices | `list_voices()` | ✅ | 41 preset voices available |
| 7 | Studio ingredients | `list_ingredients()` | ✅ | 50 saved characters returned |
| 8 | Media library | `list_media()` | ✅ | Returns all generated media with full URLs |
| 9 | List batches | `list_batches()` | ✅ | Has built-in retry for transient 500s |
| 10 | Share links | `create_share_link()` | ✅ | Returns `https://vibes.ai/join/<token>` URL |
| 11 | Video generation | `generate_video(poll=False)` | ✅ | Returns `batchId` + initial `items` with image URLs |
| 12 | Image editing | `edit_image()` | ✅ | Returns new `contentItem` with edited image |
| 13 | Timeline chat | `timeline_chat()` | ✅ | Streams SSE events (`message_delta`, `tool_call`, `completed`) |
| 14 | Video download | `download_video()` | ✅ | Downloaded 8.7 MB MP4 (saved to `test-output/`) |

## End-to-end video generation (full flow)

This is the canonical proof-of-working. The full sequence ran
successfully via the Python client:

```python
client = VibesClient(meta_session="...")
project = client.create_project(name="API Test")
batch = client.generate_video(
    project_id=project["id"],
    prompt="A drone shot of waves crashing on a rocky coastline at golden hour",
    aspect_ratio=AspectRatio.LANDSCAPE,   # 16:9 → 1280×720
    resolution=Resolution.P480,
    variations=2,
    poll_timeout=300,
)
# batch.isComplete == True
# batch.content[0].videoUrl is populated
client.download_video(batch["content"][0]["id"], "out.mp4")
# 6.7 MB MP4 saved
```

## Key implementation findings

These were the non-obvious details discovered during reverse engineering:

1. **Batch IDs must be UUID v7 with `batch-` prefix**
   - Format: `batch-<uuid_v7>`
   - The high 48 bits of the UUID encode the unix timestamp in ms
   - Without the `batch-` prefix, the `/api/download/video` endpoint
     returns 404 for content items

2. **Video generation is async; image generation is sync**
   - `POST /api/generate/videos` returns immediately with `needsPolling: true`
   - Poll `GET /api/generation-batches/{id}` until `isComplete: true`
     (typically 30-90s)
   - `POST /api/generate/images` returns immediately with `data: [...]`
     containing final image URLs — no polling needed

3. **Image input type is `"variation"`, not `"prompt"`**
   - Videos use: `{type: "prompt", value: "...", original_prompt: "...", config: {...}}`
   - Images use: `{type: "variation", image_prompt: "...", original_prompt: "...", config: {...}}`

4. **Transient 500s**
   - The `GET /api/generation-batches/{id}` and `GET /api/generation-batches`
     endpoints occasionally return 500 (race condition right after batch
     creation). The client retries up to 3 times with backoff.

5. **Python 3.11+ Enum str() gotcha**
   - `str(OwnerFilter.LIBRARY)` returns `"OwnerFilter.LIBRARY"` in
     Python 3.11+ (not `"LIBRARY"`). The client uses a `_coerce()`
     helper to extract `.value` from enums before sending as query params.

6. **Timeline chat requires `tools` field**
   - The `/api/timeline/chat/stream` endpoint returns 400 if `tools` is
     missing. The client includes a `DEFAULT_TOOLS` list (generate_image,
     generate_video, add_music, add_text_overlay) extracted from the
     Next.js bundles.

7. **TTS backend token**
   - `/api/studio/playai/tts` depends on a server-side Facebook access
     token that rotates independently of `meta_session`. If you get
     `403 Facebook expired access token`, wait and retry — the Vibes
     backend auto-refreshes this token.

8. **Supported aspect ratios**
   - Only `1:1`, `9:16`, `16:9` are supported for both images and videos.
   - Image dimensions: 1:1 → 1280×1280, 16:9 → 1280×720, 9:16 → 720×1280

## Cookie rotation

The `meta_session` cookie used for these tests expired during the
testing session (after ~1 hour of active use). When this happens:

```python
# Get a 401 like this:
# VibesAPIError: Session validation failed | status=401

# Fix: grab a fresh cookie from the browser and create a new client
client = VibesClient(meta_session="<new_cookie_from_browser>")
```

The cookie can be obtained from DevTools → Application → Cookies →
`https://vibes.ai` → `meta_session`.
