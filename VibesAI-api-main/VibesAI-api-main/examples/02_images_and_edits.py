"""
Example 2: Generate images, edit one, and explore media library.

Run:
    python examples/02_images_and_edits.py
"""
import os
from vibes_api import VibesClient, AspectRatio

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# Create a project to hold our generations
project = client.create_project(name="Image Experiments")
print(f"Project: {project['id']}")

# Generate 2 cyberpunk-style images
resp = client.generate_image(
    project_id=project["id"],
    prompt="a futuristic city skyline at dusk, neon lights, cyberpunk style, rain-soaked streets",
    aspect_ratio=AspectRatio.LANDSCAPE,
    variations=2,
)
print(f"\nGenerated {len(resp['data'])} image(s):")
for im in resp["data"]:
    print(f"  - entId={im['imageEntId']}, dims={im['dimensions']}")
    print(f"    url={im['url'][:80]}...")

# Edit the first image
if resp["data"]:
    source_id = resp["data"][0]["imageEntId"]
    print(f"\nEditing image {source_id}: 'change to daytime, sunny weather'...")
    edit_resp = client.edit_image(
        source_image_ent_id=source_id,
        edit_prompt="change to daytime, sunny weather, clear blue sky",
        project_id=project["id"],
    )
    print(f"Edited image: {edit_resp.get('contentItem', {}).get('id')}")

# List media library
print("\nRecent media library items:")
media = client.list_media(limit=5)
for item in media["items"]:
    print(f"  [{item['type']}] {item['id']}")
    print(f"      prompt: {item.get('prompt','')[:60]}")
