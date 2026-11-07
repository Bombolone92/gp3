# Reverse Engineering Notes — vibes.ai

This file documents the methodology used to reverse engineer the vibes.ai
private API and build the `vibes_api` Python client.

## Methodology

### 1. Browser automation with cookies

Used the `agent-browser` CLI (Playwright wrapper) to load vibes.ai with
the user-provided `meta_session` cookie:

```bash
agent-browser open https://vibes.ai/
agent-browser cookies set meta_session "<value>" --domain vibes.ai --path /
agent-browser reload
agent-browser snapshot -i  # confirmed logged-in state
```

### 2. Network capture during UI interactions

Clicking through the UI (Create new project → Generate video) while
capturing network traffic revealed the API flow:

```bash
agent-browser network route "**/*"
agent-browser click @e3  # Create new
agent-browser click @e24 # Generate
agent-browser network requests --filter "api"
```

This revealed the two-step batch → generate pattern.

### 3. JS bundle analysis

Downloaded all Next.js JS chunks (33 files, ~3.8 MB total) and searched
them with regex to map every API endpoint:

```python
import os, re
for fn in sorted(os.listdir('js/')):
    with open(f'js/{fn}') as f: content = f.read()
    # Find all /api/ endpoint references
    for m in re.finditer(r'"/api/[a-zA-Z0-9/_-]+"', content):
        print(m.group(0))
    # Find template literal endpoints (with ${var})
    for m in re.finditer(r'`/api/[^`]+`', content):
        print(m.group(0))
```

This surfaced **45+ API endpoints** across the entire site.

### 4. Direct API testing

Used `curl` with the cookie to probe each endpoint and discover:

- Required fields (by sending malformed bodies and reading error messages)
- Response schemas
- Auth requirements
- Polling patterns

### 5. Building the client

Implemented `VibesClient` with:

- `_uuid_v7()` for batch IDs (the server expects timestamp-ordered UUIDs)
- `_coerce()` helper for enum → string conversion (Python 3.11+ gotcha)
- Retry logic for transient 500s
- Streaming SSE parser for timeline chat
- Multipart upload helpers for files

## Key API endpoints discovered

See `README.md` for the full list. Highlights:

| Endpoint | Purpose |
|---|---|
| `POST /api/projects` | Create project |
| `POST /api/generation-batches` | Create batch shell (with client-generated UUID v7 ID) |
| `POST /api/generate/videos` | Trigger video generation |
| `POST /api/generate/images` | Trigger image generation (sync) |
| `POST /api/generate/image-edit` | Edit existing image |
| `POST /api/generate/prompts` | Enhance a seed prompt |
| `POST /api/animate/generate` | Lip sync generation |
| `POST /api/studio/playai/tts` | Text-to-speech |
| `GET  /api/studio/voices` | List TTS voices |
| `GET  /api/studio/ingredients` | List saved characters/styles/settings |
| `POST /api/timeline/chat/stream` | AI timeline assistant (SSE) |
| `POST /api/projects/{id}/timeline/download` | Render composition → MP4 |
| `GET  /api/download/video?id={contentItemId}` | Download generated video |
| `POST /api/upload-image` | Upload base64 image |
| `POST /api/upload-video-direct` | Multipart video upload |
| `POST /api/upload-audio-direct` | Multipart audio upload |
| `POST /api/share-links` | Create shareable link |
| `GET  /api/media-library` | List all media |
| `GET  /api/meta-music` | Search Meta music library |
| `POST /api/media/music/clip` | Clip a music track segment |

## Generation flow (deep dive)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Client generates UUID v7                                     │
│    batch_id = "batch-019f66c6-9721-71a9-870a-76c5a8283505"      │
│    (timestamp in high 48 bits + version 7 + random)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. POST /api/generation-batches                                 │
│    Body: {id, type, prompt, timestamp, isComplete:false,        │
│           config, projectId, content: [{id, type, isLoading}]}  │
│    Response: {batch: null, id: "<batch_id>"}                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. POST /api/generate/videos (or /images)                       │
│    Body: {batchId, inputs: [{type, value, original_prompt,      │
│           config}], config}                                     │
│    Response: {success, batchId, videoGenEntIds, needsPolling,   │
│              items: [{id, imageUrl, isLoading}]}                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Poll GET /api/generation-batches/{batch_id}                  │
│    Until: batch.isComplete == true                              │
│    Then: batch.content[i].videoUrl is populated                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. GET /api/download/video?id={contentItemId}                   │
│    Returns: binary MP4 stream                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Files

- `sample_batch_response.json` — full JSON response from a real video
  generation batch (4 variations, complete state)
- `voices.json` — full list of 41 TTS voices
- `01-homepage.png` — screenshot of the projects dashboard
- `02-after-generate.png` — screenshot of the project workspace with
  4 generated video variations

## Caveats

- The vibes.ai API is **private** and could change at any time
- Cookie-based auth rotates — the `meta_session` cookie has a finite
  lifetime (observed: ~1 hour of active use)
- The TTS endpoint depends on a separate server-side FB access token
  that rotates independently
- This reverse-engineering was performed for educational purposes;
  respect Vibes' Terms of Service when using the client
