"""
Example 3: TTS + lip sync generation pipeline.

Note: The TTS endpoint depends on a server-side Facebook access token
that rotates. If you get "403 Facebook expired access token", wait
a few minutes and retry.

Run:
    python examples/03_tts_and_lipsync.py
"""
import os
from vibes_api import VibesClient, AspectRatio

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Pick a voice
voices = client.list_voices()
print(f"{len(voices)} voices available. Using the first one: {voices[0]['name']}")

# 2) Synthesize speech
script = (
    "Hello world! This is a test of the Vibes AI text-to-speech API. "
    "I'm going to make a character say these words."
)
tts_resp = client.tts(text=script, voice=voices[0]["id"])
audio_path = client.save_tts_audio(tts_resp, "narration.mp3")
print(f"TTS saved → {audio_path}")

# 3) Upload the audio to CDN
upload = client.upload_audio_direct(audio_path)
audio_url = upload["cdnUrl"]
print(f"Audio uploaded → {audio_url[:80]}...")

# Estimate duration from word count (~150 wpm)
duration_ms = max(2000, int(len(script.split()) / 150 * 60000))
print(f"Estimated duration: {duration_ms}ms")

# 4) Create a project and generate a lip-synced video
project = client.create_project(name="Lip Sync Demo")
print(f"\nProject: {project['id']}")
print("Generating lip-sync video (this can take 30-60s)...")

resp = client.generate_lipsync(
    project_id=project["id"],
    image_prompt="a friendly news anchor in a bright modern studio, medium shot",
    script=script,
    audio_url=audio_url,
    audio_duration_ms=duration_ms,
    aspect_ratio=AspectRatio.LANDSCAPE,
)
print(f"Lip sync batch: {resp.get('data', {}).get('batchId')}")

# 5) Poll for completion
batch_id = resp["data"]["batchId"]
batch = client.poll_batch(batch_id, timeout=300)
print(f"Batch complete: {batch['isComplete']}")
for item in batch["content"]:
    if item.get("videoUrl"):
        print(f"  videoUrl: {item['videoUrl'][:100]}...")
        # Download
        client.download_video(item["id"], "lipsync.mp4")
        print(f"  → downloaded lipsync.mp4")
        break
