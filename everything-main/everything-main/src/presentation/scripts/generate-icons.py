"""Generate browser and app icons from the root icon.png (requires Pillow)."""

from pathlib import Path
from shutil import copyfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"

with Image.open(ROOT / "icon.png") as source:
    icon = source.convert("RGBA")
    if icon.width != icon.height:
        raise ValueError("icon.png must be square")
    copyfile(ROOT / "icon.png", PUBLIC / "icon.png")
    for name, size in [
        ("favicon-16x16.png", 16),
        ("favicon-32x32.png", 32),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
    ]:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / name)
    icon.save(
        PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    # Apple touch icons use an opaque background; preserve the source artwork.
    touch = Image.new("RGBA", (180, 180), "#f9f9f7")
    touch.alpha_composite(icon.resize((180, 180), Image.Resampling.LANCZOS))
    touch.convert("RGB").save(PUBLIC / "apple-touch-icon.png")
