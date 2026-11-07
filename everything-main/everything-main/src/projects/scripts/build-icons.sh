#!/usr/bin/env bash
#
# Regenerate every derived icon in public/ from the one source of truth,
# icon.png at the repo root. Run it after replacing that file:
#
#   npm run icons
#
# Needs ImageMagick 7 (`brew install imagemagick`).

set -euo pipefail
cd "$(dirname "$0")/.."

SRC=icon.png
OUT=public

command -v magick >/dev/null || { echo "ImageMagick 7 (magick) not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "$SRC not found" >&2; exit 1; }

# The source is a 602×602 canvas holding a rounded-square badge inset in a
# transparent margin, with the white mark inside that. Two crops come out of
# it: the badge alone, and the mark plus a little air around it.
BADGE=578x578+14+8
MARK=447x425+77+68

# The badge's own top-to-bottom gradient, measured off the source. Reused to
# fill in the rounded corners of the full-bleed variants below, which makes
# the seam between filler and artwork invisible.
GRADIENT='#C68FFF-#BB82FF'

# The source carries about ±1 of render grain across its flat areas, which
# by itself gives the artwork 20k distinct colours and costs PNG roughly ten
# times the bytes. Smoothing that grain and then taking a 256-colour palette
# is indistinguishable from truecolour at 1:1 — the mark's edges, pole and
# drop shadows all survive — so the big icons get it and the tiny ones,
# already only a couple of KB, are left alone.
FLATTEN=(-enhance +dither -colors 256)
PNG=(-depth 8 -strip -define png:compression-level=9)

# The mark is a thin winding path, and a straight Lanczos reduction turns it
# to mush by 16px. Each small size gets its own unsharp: enough to hold the
# curve and the flag apart, backed off as the pixels get cheaper.
sharpen_for() {
  case $1 in
    16) echo "0x0.6+1.4+0" ;;
    *)  echo "0x0.6+0.7+0" ;;
  esac
}

# ---- Tab and manifest icons -------------------------------------------
# Rounded corners stay transparent: browsers respect that, and the badge
# shape reads better than a hard square in a tab strip or a shortcut grid.
badge() {
  local size=$1 out=$2; shift 2
  magick "$SRC" -crop "$BADGE" +repage -filter Lanczos -resize "${size}x${size}" \
    "$@" "${PNG[@]}" "$out"
}

badge 16 "$OUT/favicon-16.png" -unsharp "$(sharpen_for 16)"
badge 32 "$OUT/favicon-32.png" -unsharp "$(sharpen_for 32)"
badge 192 "$OUT/icon-192.png" "${FLATTEN[@]}"
badge 512 "$OUT/icon-512.png" "${FLATTEN[@]}"

# Legacy .ico, still what some browsers and OS surfaces reach for first. Its
# frames are built from the tuned PNGs rather than auto-resized off the 48,
# so the 16 inside it is the same legible one linked above.
ICO_TMP=$(mktemp -d)
trap 'rm -rf "$ICO_TMP"' EXIT
badge 48 "$ICO_TMP/48.png" -unsharp "$(sharpen_for 48)"
magick "$ICO_TMP/48.png" "$OUT/favicon-32.png" "$OUT/favicon-16.png" \
  -depth 8 -strip "$OUT/favicon.ico"

# ---- Full bleed: apple-touch-icon -------------------------------------
# iOS ignores transparency and applies its own corner mask, so the artwork
# has to reach every edge or the badge's corners show up as black notches.
magick -size 578x578 "gradient:$GRADIENT" \
  \( "$SRC" -crop "$BADGE" +repage \) -composite \
  -filter Lanczos -resize 180x180 \
  "${FLATTEN[@]}" "${PNG[@]}" "$OUT/apple-touch-icon.png"

# ---- Full bleed: maskable ---------------------------------------------
# A maskable icon is cropped to whatever shape the platform uses, so only
# the middle 80% — a circle of radius 205 on a 512 canvas — is guaranteed
# to survive. The mark's crop is 447×425, half-diagonal 308, so it scales to
# 205/308 ≈ 0.665 of that (297px wide) to clear the circle under any mask.
magick -size 512x512 "gradient:$GRADIENT" \
  \( "$SRC" -crop "$MARK" +repage -filter Lanczos -resize 297x \) \
  -gravity center -composite \
  "${FLATTEN[@]}" "${PNG[@]}" "$OUT/icon-maskable-512.png"

echo "Wrote:"
ls -l "$OUT"/favicon.ico "$OUT"/favicon-*.png "$OUT"/icon-*.png "$OUT"/apple-touch-icon.png \
  | awk '{ printf "  %-34s %6.1f KB\n", $9, $5/1024 }'
