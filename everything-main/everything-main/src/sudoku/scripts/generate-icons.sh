#!/usr/bin/env bash
#
# Rebuild every shipped icon from the master artwork.
#
# The master (icon.png at the repo root) is a design source, not a runtime
# asset: Vite copies public/ into the build and ignores the root, so nothing
# here is shipped except what this script writes into public/.
#
# Needs ImageMagick 7 (`brew install imagemagick`). Run it after replacing the
# master, then commit what changes:
#
#     ./scripts/generate-icons.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

MASTER=icon.png
OUT=public

# Lanczos and a linear-light working space: a 1053px grid of thin rules reduced
# to 16px with the default filter loses the lines and darkens the whites.
resize() { # resize <size> <destination> [unsharp]
  magick "$MASTER" -colorspace RGB -filter Lanczos -resize "${1}x${1}" \
    -colorspace sRGB ${3:+-unsharp "$3"} \
    -depth 8 -strip -define png:compression-level=9 "$2"
}

# At 16px the digits reduce to pale smudges on a white tab strip, so that one
# size gets a light unsharp to bring the rules and the numerals back. Nothing
# above it needs the help, and sharpening 32 and up only buys halos.

# The artwork is a rounded square with a soft shadow, on transparency. That is
# what a favicon, a tab strip and the page's own header want, so these keep it.
resize 96 "$OUT/icon-96.png"    # the header mark, at 30px CSS for up to 3x
resize 192 "$OUT/icon-192.png"
resize 512 "$OUT/icon-512.png"

# A .ico carrying 16, 32 and 48: 48 is what Windows and some tab strips ask for,
# 32 is the everyday favicon, 16 is the legacy floor.
tmp=$(mktemp -d)
resize 16 "$tmp/16.png" '0x0.6+1.4+0'
resize 32 "$tmp/32.png"
resize 48 "$tmp/48.png"
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$OUT/favicon.ico"
rm -rf "$tmp"

# iOS does not honour transparency the way a favicon does, and it applies its
# own rounded mask, so the touch icon is the squircle cropped out of its shadow
# margin, filled to the edges, and flattened. White because the grid's own cells
# are white: whatever iOS's mask trims at the corners cannot show a seam.
#
# 19x22 + 1016x1014 is the opaque core of the master, measured with
# `magick icon.png -alpha extract -threshold 50% -format %@ info:`.
magick "$MASTER" -crop 1016x1016+19+20 +repage \
  -background white -alpha remove -alpha off \
  -colorspace RGB -filter Lanczos -resize 180x180 -colorspace sRGB \
  -depth 8 -strip -define png:compression-level=9 "$OUT/apple-touch-icon.png"

# Android's adaptive icon may mask the icon to a circle of 80% of its width, so
# everything that matters has to sit inside that circle. A rounded square of
# side s reaches (s/2 - r)*sqrt(2) + r from the centre; at this artwork's ~25%
# corner radius that is 0.604s, which has to stay under 0.4 * 512 = 205px. So
# s = 340, and the accent fills the rest: a white grid needs something behind it.
magick -size 512x512 xc:'#2563eb' \
  \( "$MASTER" -colorspace RGB -filter Lanczos -resize 340x340 -colorspace sRGB \) \
  -gravity center -composite -alpha off \
  -depth 8 -strip -define png:compression-level=9 "$OUT/icon-maskable-512.png"

# `xc:` and the linear-light round trip both hand back 16 bits a channel, which
# a flat blue field and a downscaled grid have no use for: it quintupled the
# maskable icon on its own. Hence the -depth 8 on every write above.

echo "Wrote:"
ls -l "$OUT"/icon-96.png "$OUT"/icon-192.png "$OUT"/icon-512.png \
      "$OUT"/favicon.ico "$OUT"/apple-touch-icon.png "$OUT"/icon-maskable-512.png
