"""
Example 7: Use ingredients (character, style, scene) in video generation.

This shows the three ways to apply an ingredient:
  1. By existing ingredient ID (use IngredientRef.by_id)
  2. By uploaded image entity ID (use CreateIngredient.by_image_ent_id)
  3. By name only (use CreateIngredient.by_name)

It also demonstrates combining character + style + scene in one generation.

Run:
    python examples/07_ingredients_full.py
"""
import os
from vibes_api import (
    VibesClient, AspectRatio, Resolution, IngredientType,
)
from vibes_api.ingredients import IngredientRef, CreateIngredient

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) List available characters, styles, and scenes
print("=== Your saved ingredients ===")
characters = client.list_characters()
styles = client.list_styles()
scenes = client.list_scenes()
print(f"  Characters: {len(characters)}")
print(f"  Styles:     {len(styles)}")
print(f"  Scenes:     {len(scenes)}")

if not characters:
    print("\nNo saved characters found. Run the Vibes UI once to create some,")
    print("or use examples/08_create_ingredient.py to create one via API.")
    raise SystemExit(0)

# 2) Pick the first character, style, scene (if available)
character = characters[0]
print(f"\nUsing character: {character['name']} (id={character['ingredientId']})")

style = styles[0] if styles else None
if style:
    print(f"Using style: {style['name']} (id={style['ingredientId']})")

scene = scenes[0] if scenes else None
if scene:
    print(f"Using scene: {scene['name']} (id={scene['ingredientId']})")

# 3) Build ingredient refs
character_ref = IngredientRef.by_id(
    ingredient_id=character["ingredientId"],
    ingredient_type=IngredientType.CHARACTER,
    name=character["name"],
    image_url=character["imageUri"],
)

ingredients = [character_ref]
if style:
    ingredients.append(IngredientRef.by_id(
        ingredient_id=style["ingredientId"],
        ingredient_type=IngredientType.STYLE,
        name=style["name"],
        image_url=style["imageUri"],
    ))
if scene:
    ingredients.append(IngredientRef.by_id(
        ingredient_id=scene["ingredientId"],
        ingredient_type=IngredientType.SETTING,
        name=scene["name"],
        image_url=scene["imageUri"],
    ))

# 4) Generate a video using the combined ingredients
project = client.create_project(name=f"Featuring {character['name']}")
print(f"\nProject: {project['id']}")
print(f"Generating video with {len(ingredients)} ingredient(s)...")

batch = client.generate_video(
    project_id=project["id"],
    prompt=f"{character['name']} walking through a misty forest at dawn, cinematic close-up",
    aspect_ratio=AspectRatio.LANDSCAPE,
    resolution=Resolution.P480,
    variations=2,
    ingredients=ingredients,
)
print(f"\nGenerated {len(batch['content'])} video(s):")
for c in batch["content"]:
    if c.get("videoUrl"):
        print(f"  - {c['id']}")
        print(f"    {c['videoUrl'][:100]}...")
