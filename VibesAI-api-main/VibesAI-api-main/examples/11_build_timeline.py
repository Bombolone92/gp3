"""
Example 11: Build a timeline composition programmatically.

Demonstrates the Composition class for building a video timeline
without the UI — add clips, text overlays, music, effects, then
export to MP4.

Run:
    python examples/11_build_timeline.py
"""
import os
from vibes_api import VibesClient, AspectRatio, Resolution
from vibes_api.composition import Composition

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Create a project
project = client.create_project(name="Timeline Demo")
print(f"Project: {project['id']}")

# 2) Generate two short video clips
print("\nGenerating clip 1...")
batch1 = client.generate_video(
    project_id=project["id"],
    prompt="a sunrise over mountains, peaceful",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P480,
    variations=1,
)
clip1_url = batch1["content"][0]["videoUrl"]
print(f"  → {clip1_url[:80]}...")

print("\nGenerating clip 2...")
batch2 = client.generate_video(
    project_id=project["id"],
    prompt="a sunset over the ocean, golden hour",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P480,
    variations=1,
)
clip2_url = batch2["content"][0]["videoUrl"]
print(f"  → {clip2_url[:80]}...")

# 3) Build the composition
print("\nBuilding composition...")
comp = Composition.create_empty(duration=10.0)

# Add the two clips back-to-back
comp.add_video_clip(
    src=clip1_url, start=0, duration=5, source_duration=5, name="Sunrise"
)
comp.add_video_clip(
    src=clip2_url, start=5, duration=5, source_duration=5, name="Sunset"
)

# Add a text overlay at the start
comp.add_text_overlay(
    text="A Day in Nature",
    start=0, end=3,
    preset="fade",
    font_size=72,
    color="#FFFFFF",
    position="center",
)

# Add fade out to the last clip
last_clip = comp.video_items[-1]
comp.set_fade(clip_id=last_clip["id"], fade_out=1.0)

print(f"  → {comp}")
print(f"  Summary: {comp.summary()}")

# 4) Save the composition to the project
print("\nSaving composition...")
client.save_composition_obj(project["id"], comp)
print("  ✓ Saved")

# 5) Export to MP4
print("\nExporting to MP4 (this may take 30-60s)...")
mp4_bytes = client.export_timeline(project["id"], comp.to_dict())
out_path = "timeline_demo.mp4"
with open(out_path, "wb") as f:
    f.write(mp4_bytes)
print(f"  → exported {len(mp4_bytes):,} bytes to {out_path}")
