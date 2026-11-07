"""
Example 14: Parse Midjourney-style prompts and use validation helpers.

Demonstrates the utility methods that don't require API calls:
- parse_midjourney_params()
- validate_prompt_length()
- validate_project_name()
- validate_image_size()

Run:
    python examples/14_utils.py
"""
import os
from vibes_api import VibesClient

# These are all static methods — no cookie needed!

# 1) Parse Midjourney parameters from a prompt
print("=== Midjourney Parameter Parser ===\n")

prompts = [
    "a cat",
    "a cat --ar 16:9",
    "cyberpunk city --sref random --ar 16:9 --v 5.2 --chaos 50 --stylize 1000",
    "portrait --oref 12345 --ow 200 --seed 42 --niji --raw",
]

for p in prompts:
    result = VibesClient.parse_midjourney_params(p)
    print(f"Prompt: {p}")
    print(f"  Clean: {result['cleanPrompt']}")
    print(f"  Params: {result['parameters']}")
    print()

# 2) Validate prompt length
print("\n=== Prompt Validation ===")
test_prompts = [
    "Short prompt",
    "x" * 5000,
    "x" * 15000,
]
for p in test_prompts:
    result = VibesClient.validate_prompt_length(p)
    status = "✓" if result["success"] else "✗"
    info = f" ({len(p)} chars)" if result["success"] else f" — {result['error']}"
    print(f"  {status} {p[:50]}{'...' if len(p) > 50 else ''}{info}")

# 3) Validate project name
print("\n=== Project Name Validation ===")
names = ["My Video", "A" * 100, "X" * 300]
for n in names:
    result = VibesClient.validate_project_name(n)
    status = "✓" if result["success"] else "✗"
    info = "" if result["success"] else f" — {result['error']}"
    print(f"  {status} '{n[:50]}{'...' if len(n) > 50 else ''}'{info}")

# 4) Validate image size (if PIL is available)
print("\n=== Image Size Validation ===")
try:
    from PIL import Image
    import tempfile
    # Create a test image
    img = Image.new("RGB", (2000, 2000), color="blue")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name, "PNG")
        path = f.name
    result = VibesClient.validate_image_size(path)
    print(f"  Test image (2000x2000): {'✓' if result['success'] else '✗'}")
    if "dimensions" in result:
        print(f"    Dimensions: {result['dimensions']}")
    os.unlink(path)

    # Create an oversized image
    big_img = Image.new("RGB", (5000, 5000), color="red")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        big_img.save(f.name, "PNG")
        path = f.name
    result = VibesClient.validate_image_size(path)
    print(f"  Big image (5000x5000): {'✓' if result['success'] else '✗'}")
    if not result["success"]:
        print(f"    Error: {result['error']}")
    os.unlink(path)
except ImportError:
    print("  (PIL not available — skipping dimension check)")

print("\n✓ All utility examples completed!")
