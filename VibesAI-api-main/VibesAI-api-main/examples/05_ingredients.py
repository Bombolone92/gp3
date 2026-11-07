"""
Example 5: Studio ingredients (characters/styles/settings) and
applying an ingredient to a video generation.

Run:
    python examples/05_ingredients.py
"""
import os
from vibes_api import VibesClient, AspectRatio, Resolution, OwnerFilter

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# List saved ingredients (characters created via the Vibes UI)
ingredients = client.list_ingredients(owner_filter=OwnerFilter.LIBRARY)
print(f"Found {len(ingredients)} ingredient(s) in your library:")
for ing in ingredients[:5]:
    print(f"  [{ing.get('ingredientType')}] {ing.get('name')}")
    print(f"      id: {ing.get('ingredientId')}")
    print(f"      desc: {(ing.get('description') or '')[:80]}...")

if not ingredients:
    print("\n(No saved ingredients. Create some via the Vibes.ai UI first.)")
    raise SystemExit(0)

# Pick the first character ingredient
character = next((i for i in ingredients if i.get("ingredientType") == "CHARACTER"), ingredients[0])
print(f"\nUsing ingredient: {character['name']}")

# Build the ingredient payload (format expected by the API)
ingredient_payload = [{
    "ingredientId": character["ingredientId"],
    "ingredientType": character["ingredientType"],
    "name": character["name"],
    "imageUri": character.get("imageUri"),
}]

# Generate a video using this character
project = client.create_project(name=f" Featuring {character['name']}")
print(f"\nProject: {project['id']}")
print(f"Generating video with character '{character['name']}'...")

batch = client.generate_video(
    project_id=project["id"],
    prompt=f"{character['name']} walking through a misty forest at dawn",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P720,
    variations=2,
    ingredients=ingredient_payload,
)
print(f"Done! Batch: {batch['id']}")
for i, c in enumerate(batch["content"]):
    if c.get("videoUrl"):
        print(f"  Video {i}: {c['videoUrl'][:80]}...")
