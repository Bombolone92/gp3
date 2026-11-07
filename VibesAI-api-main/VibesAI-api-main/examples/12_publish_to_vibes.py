"""
Example 12: Publish content to Vibes.

Shows how to publish a generated video as a public post on Vibes
(and optionally Meta AI apps).

Run:
    python examples/12_publish_to_vibes.py
"""
import os
import sys
from vibes_api import VibesClient, AspectRatio, Resolution

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Generate a video to publish
project = client.create_project(name="Publish Demo")
print(f"Project: {project['id']}")

print("\nGenerating video to publish...")
batch = client.generate_video(
    project_id=project["id"],
    prompt="a serene mountain landscape, drone shot, cinematic",
    aspect_ratio=AspectRatio.PORTRAIT,  # 9:16 for social
    resolution=Resolution.P720,
    variations=1,
)

content_item = batch["content"][0]
print(f"  → content item: {content_item['id']}")

# 2) Publish it
print("\nPublishing to Vibes...")
try:
    result = client.publish_to_vibes(
        content_item_id=content_item["id"],
        batch_id=batch["id"],
        caption="Check out this AI-generated mountain landscape! 🏔️",
        prompt=content_item.get("prompt", ""),
        image_prompt=content_item.get("imagePrompt", ""),
        video_prompt=content_item.get("videoPrompt", ""),
    )
    print(f"  ✓ Published!")
    print(f"  Response: {result}")
except Exception as e:
    print(f"  ✗ Publish failed: {e}")
    print("  (Make sure your account is allowed to publish)")
    sys.exit(1)
