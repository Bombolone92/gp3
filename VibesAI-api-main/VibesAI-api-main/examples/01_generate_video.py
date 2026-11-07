"""
Example 1: Generate a video from a text prompt (end-to-end).

Run:
    python examples/01_generate_video.py
"""
import os
from vibes_api import VibesClient, AspectRatio, Resolution

# Replace with your own meta_session cookie
META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")

client = VibesClient(meta_session=META_SESSION)

# 1) Verify auth
me = client.get_me()
print(f"Logged in as: {me['username']} (id={me['id']})")

# 2) Create a project
project = client.create_project(name="API Demo - Sunset")
print(f"Created project: {project['id']}")

# 3) Generate 4 video variations
batch = client.generate_video(
    project_id=project["id"],
    prompt="A serene mountain landscape at sunset, slow pan across the peaks, golden light",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P720,
    variations=4,
)
print(f"Batch complete: {batch['id']}")
print(f"Generated {len(batch['content'])} video(s):")
for i, item in enumerate(batch["content"]):
    print(f"  [{i}] id={item['id']}")
    print(f"      videoUrl={item['videoUrl'][:80]}..." if item.get("videoUrl") else "      (no video)")

# 4) Download the first video
if batch["content"] and batch["content"][0].get("videoUrl"):
    out = client.download_video(batch["content"][0]["id"], "sunset.mp4")
    print(f"\nDownloaded first video → {out}")
