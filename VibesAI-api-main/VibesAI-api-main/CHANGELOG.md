# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-07-16

### 🎉 Major release — closed 50+ feature gaps from the FEATURE_MATRIX

This release implements nearly all the missing features identified in
the v1.1.0 feature matrix. Method count grew from 85 → 127 (49% increase).

### 🆕 Added — Timeline Composition class (24 features!)

The biggest gap in v1.1.0 was timeline editing. New `Composition` class
in `vibes_api/composition.py` mirrors all client-side timeline operations:

- `add_video_clip()`, `add_image_clip()`, `add_audio_clip()`
- `add_text_overlay()` with all presets (fade, glow, glitch, etc.)
- `resize_clip()` (absolute duration, capped at sourceDuration)
- `move_clip()`, `split_clip()`, `duplicate_clip()`, `delete_clip()`
- `reorder_clips()` (single-call list mode + single-clip move mode)
- `extend_timeline_to()` (target total duration)
- `set_fade()` (capped at half clip duration)
- `set_volume()` (clamped 0.0-1.0)
- `set_speed()` (0.1-10.0, recalculates duration)
- `add_track()`, `delete_track()`, `rename_track()`, `mute_track()`
- `update_text_overlay()` (partial updates)
- `unlink_audio_from_video()`, `link_audio_to_video()`
- `slip_audio()`, `replace_audio()`
- `delete_all_clips()`, `delete_timeline()`
- `summary()`, `clone()`, `to_dict()`, `find_clip()`, `find_clip_by_name()`
- `create_empty()`, `from_project()` class methods

Client helpers: `client.get_composition()` and `client.save_composition_obj()`.

### 🆕 Added — Publishing / Posting

- `publish_to_vibes()` — POST /api/meta-profiles/publish
  - Caption, audio types, content attribution
  - Image/video handles + all prompt fields

### 🆕 Added — Resumable & batch uploads

- `upload_video_resumable()` — for large files (>50MB)
  - Progress callback support
  - Max size validation (500MB default)
  - Falls back to direct upload for small files
- `upload_images_batch()` — upload up to 12 images at once
  - Per-file size validation (10MB default)
  - Per-file error isolation
- `bulk_upload_to_project()` — register multiple uploaded files at once

### 🆕 Added — Moodboard PATCH (update)

- `update_moodboard()` — add/remove images, rename
- `lookup_moodboard_by_code()` — find moodboard ID by code

### 🆕 Added — Share link reset

- `reset_share_link()` — revoke existing + create new in one call
  - Mirrors "Reset link" UI button

### 🆕 Added — Playables CRUD (8 methods)

- `list_playables()`, `get_playable()`, `create_playable()`
- `update_playable()`, `delete_playable()`, `duplicate_playable()`
- `generate_playable_thumbnail()`

### 🆕 Added — Multi-turn timeline chat

- `timeline_chat_multi_turn()` — conversation history support
- `submit_tool_result()` — execute tools locally + continue conversation
- `conversation_id` reuse across turns

### 🆕 Added — HeyGen avatar animation

- `generate_heygen_avatar()` — high-quality lip sync via HeyGen
- `regenerate_lipsync()` — regenerate with same audio + new prompt

### 🆕 Added — Resilient SSE streaming

- `stream_sync_updates_resilient()` — auto-reconnect with exponential backoff
  - max_retries=5, base_backoff=1.0s, max_backoff=30.0s
- `stream_batch_updates_resilient()` — same, with idle_timeout=300s

### 🆕 Added — Rate limit handling

- `get_rate_limit_status()` — current cooldown state
- `_set_rate_limit_cooldown()` — internal cooldown tracking
- `_check_rate_limit()` — raise if in cooldown
- Auto-tracks 429 responses

### 🆕 Added — Audio features

- `check_original_audio()` — POST /api/meta-music/oa-check
- `search_music_filtered()` — auto-filters out original audio
- `resolve_audio_urls()` — batch resolve CDN URLs
- `proxy_audio_url()` — build proxy URL for licensed audio
- `proxy_audio_url_signed()` — proxy for already-signed URLs

### 🆕 Added — Export & ingredient updates

- `get_pending_export()` — check for in-progress exports on project load
- `update_ingredient()` — update via Meta GraphQL (UpdateIngredientMutation)
- `remove_project_asset()` — DELETE /api/projects/{id}/assets/{assetId}
- `update_batch()` — PUT /api/generation-batches/{id}
- `download_content()` — generic /api/download/{type} endpoint
- `list_media_by_ingredient()` — filter media by ingredient usage
- `check_token()` — POST /api/auth/check-token

### 🆕 Added — Client-side validation helpers

All as static methods (no cookie required):

- `validate_prompt_length()` — 10,000 char limit
- `validate_project_name()` — 255 char limit
- `validate_username()` — 3-30 chars
- `validate_image_size()` — 10MB + 4096px limits (uses PIL if available)
- `validate_music_clip_duration()` — 60s per-song limit
- `validate_music_clip_short()` — 9s MUSIC_CLIP_MAX_DURATION_MS

### 🆕 Added — Midjourney parameter parser

- `parse_midjourney_params()` extracts from a prompt:
  - `--sref` (random, numeric IDs, URLs)
  - `--oref` (object/character reference IDs)
  - `--sw` / `--ow` (style/object weights)
  - `--seed`, `--chaos` / `--c`, `--stylize` / `--s`
  - `--ar` (aspect ratio), `--v` (version)
  - Boolean flags: `--niji`, `--raw`, `--tile`, `--loop`, `--turbo`, etc.
  - Returns cleanPrompt + parameters dict

### 🆕 Added — CLI commands (14 new)

- `vibes-api publish` — publish content to Vibes
- `vibes-api moodboard-update` — update moodboard
- `vibes-api moodboard-lookup` — lookup by code
- `vibes-api share-reset` — reset share link
- `vibes-api playables list/get/delete` — playables CRUD
- `vibes-api ingredients-update` — update ingredient
- `vibes-api audio-resolve` — resolve audio URLs
- `vibes-api audio-proxy` — build proxy URL
- `vibes-api check-token` — validate session
- `vibes-api rate-limit` — show rate limit status
- `vibes-api pending-export` — check pending export
- `vibes-api parse-midjourney` — parse Midjourney params (offline)
- `vibes-api validate-prompt` — validate prompt length (offline)

### 🆕 Added — Examples

- `examples/11_build_timeline.py` — programmatic timeline building
- `examples/12_publish_to_vibes.py` — publish content to Vibes
- `examples/13_multi_turn_chat.py` — multi-turn timeline chat with tool results
- `examples/14_utils.py` — Midjourney parser + validation helpers (offline)

### 🆕 Added — Test suite

- `tests/test_all.py` — 106 unit tests covering:
  - All 127 client methods exist
  - Composition class (30+ tests)
  - Ingredient builders
  - Frame handle builder
  - Entity ID extraction
  - Validation helpers
  - Midjourney parameter parser
  - CLI parser builds correctly with all subcommands
  - All API endpoints discovered in JS bundles are referenced in source
  - Rate limit tracking
  - UUID v7 generator
  - Enum values

### 🔧 Improved

- `__init__.py` now exports `Composition`
- CLI `main()` allows offline commands (parse-midjourney, validate-prompt)
  to run without a cookie
- Better error messages throughout

## [1.1.0] — 2026-07-16

### 🆕 Added — Video editing flows (mirrors UI "Extend" / "Edit" panels)
- `extend_video()` — extend a video clip by ~5 seconds (auto or manual)
- `auto_extend_video()` — shortcut for auto extend (no prompt)
- `manual_extend_video()` — shortcut for manual extend (with directive prompt)
- `edit_video()` — video-to-video (v2v) editing with a directive
- `animate_image()` — animate a still image (auto or manual)
- `auto_animate_image()` / `manual_animate_image()` — shortcuts
- `regenerate_batch()` — re-roll a batch with same or new prompt

### 🆕 Added — Ingredients (characters, styles, scenes)
- `list_characters()`, `list_styles()`, `list_scenes()` — typed list shortcuts
- `create_ingredient()` — create a new ingredient via POST /api/studio/ingredients
- `delete_ingredient()` — delete an ingredient by ID
- New `vibes_api.ingredients` module with:
  - `IngredientRef.by_id()` — build an existing-ingredient reference
  - `CreateIngredient.by_image_ent_id()` — build an inline-create payload from an uploaded image
  - `CreateIngredient.by_name()` — build an inline-create payload by name only
  - `build_ingredient_payload()` — combine character/style/scene refs into a single payload
- `generate_video()` and `generate_image()` now accept `ingredients=[...]` and `create_ingredients=[...]`

### 🆕 Added — Start/end frame (image-to-video with keyframes)
- `build_frame_handle()` — convert an upload_image() response into a frame handle dict
- `generate_video(start_frame=..., end_frame=...)` — generates a video that interpolates between two keyframes
  - Start frame → stored as `directPromptImageHandle` on the config
  - End frame → stored as `lastFrameOilHandle` / `lastFrameImageUrl` / `lastFrameImageEntId`

### 🆕 Added — Moodboard support
- `generate_video(moodboard=...)` and `generate_image(moodboard=...)` — apply a style reference

### 🆕 Added — Real-time sync (SSE)
- `get_sync_status()` — GET /api/sync?entityType=...&entityId=...
- `stream_sync_updates()` — SSE stream of update events (snapshot / update / bye)
- `stream_batch_updates()` — SSE stream of batch generation progress

### 🆕 Added — Account & quota
- `upload_profile_picture()`, `upload_profile_picture_file()`
- `delete_account()`, `delete_all_media()`, `remove_all_posts()`
- `get_quota_upsell()`
- `report_bug()`, `record_consent()`

### 🆕 Added — CLI commands
- `vibes-api videos extend` — auto/manual extend
- `vibes-api videos edit` — v2v edit
- `vibes-api images animate` — auto/manual animate
- `vibes-api batches regenerate` — re-roll a batch
- `vibes-api ingredients create` / `delete` — ingredient CRUD
- `vibes-api ingredients list --type CHARACTER|STYLE|SETTING` — typed list
- `vibes-api sync status` / `stream` — real-time sync
- `vibes-api quota` — quota upsell info

### 🆕 Added — Examples
- `examples/06_extend_video.py` — auto + manual extend demo
- `examples/07_ingredients_full.py` — character + style + scene combos
- `examples/08_create_ingredient.py` — create ingredient via API
- `examples/09_start_end_frame.py` — image-to-video with keyframes
- `examples/10_edit_video.py` — v2v edit

### 🆕 Added — New enums
- `IngredientType` (CHARACTER, STYLE, SETTING)
- `EntityType` (project, content-item) — for share-links, sync, collaborators
- `SyncMode` (polling, sse)
- `TextOverlayPreset` (fade, slide-up, surround, etc.) — for timeline chat
- `TextOverlayPosition` (center, top-left, etc.)
- `VideoModel.EXTEND` and `VideoModel.VIDEO_EDIT` — for extend/v2v flows

### 🔧 Improved
- Better error messages: `_check()` now includes the response body in the error string for debugging
- `poll_batch()` retries transient 500s (up to 3 times with backoff)
- `list_batches()` retries transient 500s
- `list_ingredients()` now accepts an optional `ingredient_type` filter
- New `_coerce()` helper centralizes Python 3.11+ Enum→string coercion

## [1.0.0] — 2026-07-15

### 🎉 Initial release

Reverse-engineered Python client for vibes.ai covering:

- Project management (list / create / get / update / delete / duplicate)
- Text-to-video generation (midjen-short, 9:16/16:9/1:1, 480p/720p)
- Text-to-image generation (synchronous)
- Image editing (prompt-driven)
- Prompt enhancement (4 AI-rewritten variations)
- Lip sync / animation generation
- Text-to-speech (TTS) with 41 preset voices
- Media library management
- Generation batch polling
- Share links
- Studio ingredients listing
- Timeline AI chat (streaming SSE)
- Music / audio clip extraction
- Direct file uploads (image / video / audio)
- Timeline export to MP4
- Full CLI (`vibes-api` command)

87 public methods, 5 example scripts, comprehensive README & QUICKREF.

End-to-end test confirmed: generated a 6.7 MB MP4 from the prompt
"A drone shot of waves crashing on a rocky coastline at golden hour" via pure API calls.
