# Quick Reference Card

## Install

```bash
pip install -e /home/z/my-project/download/vibes-api
```

## Set your cookie

```bash
export VIBES_META_SESSION="e60e910a-..."
```

## 30-second recipes

### Generate a video

```python
from vibes_api import VibesClient, AspectRatio, Resolution

client = VibesClient(meta_session="...")
project = client.create_project(name="Demo")
batch = client.generate_video(
    project_id=project["id"],
    prompt="sunset over the ocean, drone shot",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P720,
    variations=4,
)
client.download_video(batch["content"][0]["id"], "sunset.mp4")
```

### One-liner via CLI

```bash
vibes-api one-shot --prompt "sunset over the ocean" \
  --aspect-ratio 16:9 --resolution 720p --download-dir ./out
```

### Generate an image

```python
resp = client.generate_image(
    project_id=project["id"],
    prompt="cyberpunk city at night",
    aspect_ratio="1:1",
)
image_url = resp["data"][0]["url"]
```

### Enhance a prompt

```python
variations = client.enhance_prompt(prompt="a cat")
print(variations[0]["image"])  # Midjourney-style enhanced image prompt
print(variations[0]["video"])  # Corresponding animation prompt
```

### Text-to-speech

```python
voices = client.list_voices()  # 41 voices
tts = client.tts(text="Hello world", voice="play_ai_Marisol")
client.save_tts_audio(tts, "hello.mp3")
```

### Stream timeline AI chat

```python
for event in client.timeline_chat("add a 5 second sunset clip"):
    if event["type"] == "message_delta":
        print(event["delta"], end="", flush=True)
    elif event["type"] == "completed":
        break
```

### Edit an existing image

```python
result = client.edit_image(
    source_image_ent_id="1177...",  # from generate_image response
    edit_prompt="change to night time",
    project_id=project["id"],
)
```

### List and download your media

```python
media = client.list_media(limit=20)
for item in media["items"]:
    print(f"[{item['type']}] {item['id']}")

# Download a video
client.download_video(media["items"][0]["id"], "out.mp4")
```

### Create a share link

```python
link = client.create_share_link("project", project["id"])
print(link["url"])  # https://vibes.ai/join/<token>
```

## Common patterns

### Poll without blocking

```python
# Start generation, return immediately
gen_resp = client.generate_video(
    project_id=project["id"],
    prompt="...",
    poll=False,
)
batch_id = gen_resp["batchId"]

# Poll later (e.g., from a different process)
batch = client.poll_batch(batch_id, timeout=300)
```

### Apply a saved character to a generation

```python
ingredients = client.list_ingredients()
character = next(i for i in ingredients if i["ingredientType"] == "CHARACTER")
batch = client.generate_video(
    project_id=project["id"],
    prompt=f"{character['name']} walking through a forest",
    ingredients=[{
        "ingredientId": character["ingredientId"],
        "ingredientType": character["ingredientType"],
        "name": character["name"],
        "imageUri": character["imageUri"],
    }],
)
```

### Upload and use a start frame (image-to-video)

```python
upload = client.upload_image_file("my_image.png")
batch = client.generate_video(
    project_id=project["id"],
    prompt="camera slowly zooms in",
    start_frame_image_handle={
        "image_ent_id": upload["mediaEntId"],
        "image_url": upload["imageUrl"],
        "source": "upload",
    },
)
```

## CLI cheat sheet

```bash
vibes-api me                                  # current user
vibes-api projects list --limit 10
vibes-api projects create --name "My Video"
vibes-api videos generate --project-id <id> --prompt "..." \
  --aspect-ratio 16:9 --resolution 720p --variations 4 \
  --download-dir ./out

# 🆕 Video extend (auto / manual)
vibes-api videos extend --project-id <id> --batch-id <batch>           # auto
vibes-api videos extend --project-id <id> --batch-id <batch> --prompt "camera pans up"  # manual

# 🆕 Video edit (v2v)
vibes-api videos edit --project-id <id> --batch-id <batch> --prompt "change to rainy"

# 🆕 Image animate (auto / manual)
vibes-api images animate --project-id <id> --content-id <content>      # auto
vibes-api images animate --project-id <id> --content-id <content> --prompt "zoom in"  # manual

# 🆕 Batch regenerate (re-roll)
vibes-api batches regenerate <batch-id> --project-id <id>
vibes-api batches regenerate <batch-id> --project-id <id> --prompt "new prompt"

vibes-api images generate --project-id <id> --prompt "..."
vibes-api voices list
vibes-api tts --voice play_ai_Marisol --text "Hello" --out hello.mp3
vibes-api media list --type video --limit 10
vibes-api media download --id <id> --out video.mp4
vibes-api prompts enhance --prompt "a cat"

# 🆕 Ingredient CRUD
vibes-api ingredients list [--type CHARACTER|STYLE|SETTING]
vibes-api ingredients create --name "Wizard" --type CHARACTER \
  --image-ent-id <id> --image-url <url>
vibes-api ingredients delete <ingredient_id>

vibes-api share create --entity-type project --entity-id <id>
vibes-api batches poll <batch_id> --timeout 180
vibes-api music search --query "lofi"
vibes-api chat "add a 5 second sunset clip"

# 🆕 Real-time sync
vibes-api sync status --entity-type project --entity-id <id>
vibes-api sync stream --entity-type project --entity-id <id>  # Ctrl+C to stop

# 🆕 Quota
vibes-api quota

vibes-api one-shot --prompt "..." --download-dir ./out
```

## 🆕 New in v1.1.0 — Video extend / edit / animate

```python
# Auto-extend a video (no directive, server continues original prompt)
extended = client.extend_video(
    project_id=project["id"],
    source_video=batch["content"][0],  # full content item dict from get_batch()
)

# Manual-extend with a directive
extended = client.manual_extend_video(
    project_id=project["id"],
    source_video=batch["content"][0],
    prompt="camera pans up to reveal the sky",
)

# Video-to-video edit (re-render with a directive)
edited = client.edit_video(
    project_id=project["id"],
    source_video=batch["content"][0],
    prompt="change the weather to heavy rain",
)

# Image-to-video animate (auto or manual)
animated = client.animate_image(
    project_id=project["id"],
    source_image=image_content_item,
    prompt="camera zooms in slowly",  # optional, omit for auto
)
```

## 🆕 New in v1.1.0 — Start/end frame (keyframe interpolation)

```python
from vibes_api import AspectRatio

# Generate two keyframe images
start_img = client.generate_image(
    project_id=project["id"],
    prompt="a rose in full bloom",
    aspect_ratio=AspectRatio.LANDSCAPE,
)["data"][0]
end_img = client.generate_image(
    project_id=project["id"],
    prompt="a withered, dried rose",
    aspect_ratio=AspectRatio.LANDSCAPE,
)["data"][0]

# Build frame handles
start_frame = client.build_frame_handle({
    "mediaEntId": start_img["imageEntId"],
    "imageUrl": start_img["url"],
})
end_frame = client.build_frame_handle({
    "mediaEntId": end_img["imageEntId"],
    "imageUrl": end_img["url"],
})

# Generate the interpolating video
batch = client.generate_video(
    project_id=project["id"],
    prompt="the rose slowly wilts, time-lapse",
    start_frame=start_frame,
    end_frame=end_frame,
    aspect_ratio=AspectRatio.LANDSCAPE,
)
```

## 🆕 New in v1.1.0 — Ingredients (character / style / scene)

```python
from vibes_api import IngredientType
from vibes_api.ingredients import IngredientRef, CreateIngredient

# Apply an EXISTING ingredient (from your library)
character = IngredientRef.by_id(
    ingredient_id="800957099700717",
    ingredient_type=IngredientType.CHARACTER,
    name="Valdrin",
    image_url="https://...",
)

# Create a new ingredient INLINE (from an uploaded image)
style = CreateIngredient.by_image_ent_id(
    image_ent_id="1177...",
    ingredient_type=IngredientType.STYLE,
    name="Cyberpunk neon",
    image_url="https://...",
)

# Create a new ingredient by name only (uses prompt-generated image)
scene = CreateIngredient.by_name(
    ingredient_type=IngredientType.SETTING,
    name="Misty forest at dawn",
)

# Pass to generate_video (or generate_image)
batch = client.generate_video(
    project_id=project["id"],
    prompt="...",
    ingredients=[character],            # existing refs
    create_ingredients=[style, scene],  # inline creates
)

# CRUD via API
client.create_ingredient(
    name="My Character",
    ingredient_type=IngredientType.CHARACTER,
    source_image_ent_id="1177...",
    image_url="https://...",
    description="A friendly wizard...",
)
client.list_characters()  # or list_styles(), list_scenes()
client.delete_ingredient("800957099700717")
```

## 🆕 New in v1.1.0 — Real-time sync (SSE)

```python
# Get the last-updated timestamp
status = client.get_sync_status("project", project_id)
print(status["updatedAt"])

# Stream live updates (for collaborative editing)
for event in client.stream_sync_updates("project", project_id):
    print(f"[{event.get('type')}] {event.get('updatedAt')}")

# Stream a batch's generation progress
for event in client.stream_batch_updates(batch_id):
    if event.get("isComplete"):
        print(f"Done! Items: {len(event.get('items', []))}")
        break
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401 Session validation failed` | Cookie expired — grab a fresh `meta_session` from the browser |
| `403 Facebook expired access token` (TTS only) | Server-side FB token rotated — wait 5 min and retry |
| `500 Failed to fetch generation batch` | Transient — client retries automatically; if persistent, slow down |
| `400 ownerFilter is required` | Pass `owner_filter="LIBRARY"` to `list_ingredients()` |
| `400 tools is required` (timeline chat) | Client includes `DEFAULT_TOOLS` automatically; pass `tools=[...]` to override |
| `404 Content item not found` (download) | Wait for batch `isComplete=true` before downloading |
| Video generation takes >60s | Normal — videos can take 30-90s. Increase `poll_timeout=300` |
| `Original prompt not available for extend` | Pass the full content item dict from `get_batch()`, not just an ID |
| `Video handle or entity ID is required for extend` | The source video lacks `videoHandle` metadata — try a different one |
| `GENERATION_FAILED` for images with `16:9` | Some aspect ratios occasionally fail; retry or use `1:1` |
| `extend`/`v2v` returns 500 | Source video may be too old — needs `videoHandle` from a recent generation |
