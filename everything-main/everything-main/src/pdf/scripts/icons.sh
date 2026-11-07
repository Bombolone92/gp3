#!/bin/sh
# Regenerate app assets from the root icon with ImageMagick 7 (magick).
set -eu
cd "$(dirname "$0")/.."
mkdir -p public/icons
for size in 16 32 48 192 512; do
  case "$size" in
    16|32|48) output="public/favicon-${size}x${size}.png" ;;
    *) output="public/icons/icon-${size}.png" ;;
  esac
  magick icon.png -resize "${size}x${size}" -background none -gravity center \
    -extent "${size}x${size}" -strip "$output"
done
magick public/favicon-16x16.png public/favicon-32x32.png public/favicon-48x48.png public/favicon.ico
magick icon.png -resize 180x180 -background '#f9f9f7' -gravity center \
  -extent 180x180 -alpha remove -alpha off -strip public/apple-touch-icon.png
