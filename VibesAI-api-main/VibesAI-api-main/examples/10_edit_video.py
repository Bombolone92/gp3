"""
Example 10: Edit an existing video (video-to-video).

Takes a previously generated video and re-renders it with a new directive
(e.g., "change the weather to rain"). This is the v2v flow.

Run:
    python examples/10_edit_video.py
"""
import os
import sys
from vibes_api import VibesClient, AspectRatio, Resolution

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Find a recent video in your media library
print("Looking for a recent video to edit...")
media = client.list_media(limit=10, type="video")
if not media["items"]:
    print("No videos found in your media library. Generate one first.")
    sys.exit(1)

# Take the most recent
source_item = media["items"][0]
print(f"  → found video: {source_item['id']}")
print(f"    prompt: {source_item.get('prompt', '')[:80]}...")

# 2) We need the batch this video belongs to (to get the structuredOutput)
batch_id = source_item.get("batchId")
if not batch_id:
    print("Source item has no batchId — can't fetch full content item.")
    sys.exit(1)

batch = client.get_batch(batch_id)
# Find the matching content item
source_video = next(
    (c for c in batch.get("content", []) if c["id"] == source_item["id"]),
    batch["content"][0] if batch.get("content") else None,
)
if not source_video:
    print("Could not find content item in batch.")
    sys.exit(1)
print(f"  → source video has videoUrl: {bool(source_video.get('videoUrl'))}")

# 3) Need a project to attach the edit to
# Use the source batch's project
project_id = batch.get("projectId")
if not project_id:
    project = client.create_project(name="Video Edit Demo")
    project_id = project["id"]
print(f"  → project: {project_id}")

# 4) Edit the video with a new directive
print("\nEditing video: 'change the weather to heavy rain, dark and moody atmosphere'...")
try:
    edit_batch = client.edit_video(
        project_id=project_id,
        source_video=source_video,
        prompt="change the weather to heavy rain, dark and moody atmosphere",
    )
    print(f"  → edit batch: {edit_batch['id']}")
    if edit_batch["content"] and edit_batch["content"][0].get("videoUrl"):
        client.download_video(edit_batch["content"][0]["id"], "edited_video.mp4")
        print(f"  → downloaded edited_video.mp4")
except Exception as e:
    print(f"  ✗ edit failed: {e}")
    print("  (some videos can't be edited if they're missing videoHandle metadata)")
