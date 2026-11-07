"""Generate web icons from root icon.png. Requires Python 3 and Pillow."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"
BRAND = "#375f91"


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    source = Image.open(ROOT / "icon.png").convert("RGBA")
    side = max(source.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(source, ((side - source.width) // 2, (side - source.height) // 2))

    def resized(size):
        return square.resize((size, size), Image.Resampling.LANCZOS)

    for size in (16, 32):
        resized(size).save(PUBLIC / f"favicon-{size}x{size}.png", optimize=True)
    square.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for size in (64, 192, 512):
        resized(size).save(ICONS / f"icon-{size}.png", optimize=True)

    # Apple touch icons need an opaque background; iOS applies its own mask.
    touch = Image.new("RGBA", (180, 180), BRAND)
    touch.alpha_composite(resized(180))
    touch.convert("RGB").save(ICONS / "apple-touch-icon.png", optimize=True)

    # Keep the entire source inside the maskable icon's central safe circle
    # (radius 40% of 512); even the artwork's corners survive every mask.
    maskable = Image.new("RGBA", (512, 512), BRAND)
    maskable.alpha_composite(resized(288), (112, 112))
    maskable.convert("RGB").save(ICONS / "icon-maskable-512.png", optimize=True)


if __name__ == "__main__":
    main()
