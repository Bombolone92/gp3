"""
Example 9: Start/end frame (image-to-video with keyframes).

Generates two images (start and end keyframes), then generates a video
that interpolates between them.

Run:
    python examples/09_start_end_frame.py
"""
import os
from vibes_api import VibesClient, AspectRatio, Resolution

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Create a project
project = client.create_project(name="Keyframe Interpolation Demo")
print(f"Project: {project['id']}")

# 2) Generate the start frame (an image)
print("\nGenerating START frame...")
start_resp = client.generate_image(
    project_id=project["id"],
    prompt="A close-up of a single red rose in full bloom, morning dew on petals, soft natural light",
    aspect_ratio=AspectRatio.LANDSCAPE,
)
start_image = start_resp["data"][0]
print(f"  → start imageEntId: {start_image['imageEntId']}")

# 3) Generate the end frame (an image)
print("\nGenerating END frame...")
end_resp = client.generate_image(
    project_id=project["id"],
    prompt="A close-up of a withered, dried rose with scattered petals, late afternoon golden light",
    aspect_ratio=AspectRatio.LANDSCAPE,
)
end_image = end_resp["data"][0]
print(f"  → end imageEntId: {end_image['imageEntId']}")

# 4) Build frame handles
start_frame = client.build_frame_handle({
    "mediaEntId": start_image["imageEntId"],
    "imageUrl": start_image["url"],
})
end_frame = client.build_frame_handle({
    "mediaEntId": end_image["imageEntId"],
    "imageUrl": end_image["url"],
})

# 5) Generate the video using both frames
print("\nGenerating video that interpolates start → end frame...")
batch = client.generate_video(
    project_id=project["id"],
    prompt="the rose slowly wilts and dries, time-lapse effect",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P480,
    variations=1,
    start_frame=start_frame,
    end_frame=end_frame,
)

if batch["content"] and batch["content"][0].get("videoUrl"):
    out_path = "rose_wilting.mp4"
    client.download_video(batch["content"][0]["id"], out_path)
    print(f"\n  → downloaded {out_path}")
else:
    print("\n  (no video URL returned)")
    print(batch)
