#!/bin/sh
# Regenerate browser/install assets from the project's source icon. Requires ImageMagick.
set -eu
cd "$(dirname "$0")/.."
mkdir -p public/icons
for size in 16 32 48; do
  magick icon.png -resize "${size}x${size}" -strip "public/favicon-${size}x${size}.png"
done
magick public/favicon-16x16.png public/favicon-32x32.png public/favicon-48x48.png public/favicon.ico
for size in 192 512; do
  magick icon.png -resize "${size}x${size}" -strip "public/icons/icon-${size}.png"
done
# Apple supplies its own rounded corners; give it an opaque background.
magick icon.png -resize 180x180 -background '#356d49' -alpha remove -alpha off -strip public/apple-touch-icon.png
# Keep the complete artwork inside the central safe area for launcher masks.
magick icon.png -resize 360x360 -background '#356d49' -gravity center -extent 512x512 -alpha remove -alpha off -strip public/icons/icon-maskable-512.png
