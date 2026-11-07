"""
Example 8: Create a new ingredient (character / style / scene) via API.

The Vibes UI creates ingredients from generated images, but you can do the
same via the API:
  1. Generate an image (or upload one)
  2. Create an ingredient from that image's imageEntId

Run:
    python examples/08_create_ingredient.py
"""
import os
from vibes_api import VibesClient, AspectRatio, IngredientType

META_SESSION = os.environ.get("VIBES_META_SESSION", "PASTE_YOUR_COOKIE_HERE")
client = VibesClient(meta_session=META_SESSION)

# 1) Create a project (ingredients don't strictly need a project, but it's
#    a clean way to scope the generated image)
project = client.create_project(name="Ingredient Creation Demo")
print(f"Project: {project['id']}")

# 2) Generate an image of a character to use as the ingredient image
print("\nGenerating source image for ingredient...")
resp = client.generate_image(
    project_id=project["id"],
    prompt="A friendly wizard with a long white beard, pointy blue hat, "
           "and wise twinkling eyes. Fantasy art style, portrait orientation.",
    aspect_ratio=AspectRatio.SQUARE,
)
image_data = resp["data"][0]
image_ent_id = image_data["imageEntId"]
image_url = image_data["url"]
print(f"  → imageEntId: {image_ent_id}")
print(f"  → imageUrl:   {image_url[:80]}...")

# 3) Create the ingredient
print("\nCreating CHARACTER ingredient 'Eldric the Wise'...")
result = client.create_ingredient(
    name="Eldric the Wise",
    ingredient_type=IngredientType.CHARACTER,
    source_image_ent_id=image_ent_id,
    image_url=image_url,
    description="A friendly old wizard with a long white beard and a pointy blue hat. "
                "Wise, patient, and a little forgetful.",
    personality="Patient, wise, occasionally forgetful. Speaks slowly and "
                "deliberately, often pausing to consult ancient tomes.",
    backstory="Eldric has tended the Great Library of Arinthor for over 200 years. "
              "He was once a great adventurer but now prefers the company of books.",
    core_beliefs="Knowledge must be preserved and shared. Every problem has a "
                 "solution if you read enough books.",
)
new_ingredient = result["ingredient"]
print(f"  → ingredientId: {new_ingredient['ingredientId']}")
print(f"  → name: {new_ingredient['name']}")
if result.get("usedExistingName"):
    print("  ⚠ An ingredient with this name already existed — used the existing one.")

# 4) Verify by listing
print("\nListing your saved characters:")
characters = client.list_characters()
for c in characters[:10]:
    print(f"  - {c['name']} (id={c['ingredientId']})")

# 5) Cleanup (uncomment to delete the test ingredient)
# print(f"\nDeleting test ingredient {new_ingredient['ingredientId']}...")
# client.delete_ingredient(new_ingredient["ingredientId"])
# print("Deleted.")
