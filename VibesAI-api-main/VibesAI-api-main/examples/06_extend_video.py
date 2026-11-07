"""
Example 6: Auto-extend and manual-extend a generated video.

This demonstrates the two extend modes that the Vibes UI exposes:
  - Auto extend: continues the original prompt with no new directive
  - Manual extend: provides a directive like "the camera pans up to reveal the sky"

Both call the same backend endpoint (/api/generate/videos with type:"extend"
and config.videoModel="midjen-extend"); the only difference is whether
``extendDirective`` is set on the config.

Run:
    python examples/06_extend_video.py
"""
import os
import sys
from vibes_api import VibesClient, AspectRatio, Resolution

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Generate a short video to extend
project = client.create_project(name="Extend Demo")
print(f"Project: {project['id']}")

print("Generating base video (5s, 480p, 16:9)...")
batch = client.generate_video(
    project_id=project["id"],
    prompt="A drone shot flying over green hills at sunrise",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P480,
    variations=1,
)
source_video = batch["content"][0]
print(f"  → got video: {source_video['id']}")
print(f"    videoUrl: {source_video['videoUrl'][:80]}...")

# 2) Auto-extend: no prompt, just continue
print("\nAuto-extending (continues the original prompt)...")
extended_auto = client.extend_video(
    project_id=project["id"],
    source_video=source_video,
    # No prompt = auto extend
)
print(f"  → extended video: {extended_auto['content'][0]['id']}")

# 3) Manual-extend: provide a directive
print("\nManual-extending (with directive: 'camera tilts up to reveal the sky')...")
extended_manual = client.manual_extend_video(
    project_id=project["id"],
    source_video=source_video,
    prompt="camera tilts up to reveal a clear blue sky with fluffy clouds",
)
print(f"  → extended video: {extended_manual['content'][0]['id']}")

# 4) Download both extensions
for i, batch in enumerate([extended_auto, extended_manual]):
    if batch["content"] and batch["content"][0].get("videoUrl"):
        out_path = f"extended_{i}.mp4"
        client.download_video(batch["content"][0]["id"], out_path)
        print(f"  → downloaded {out_path}")
