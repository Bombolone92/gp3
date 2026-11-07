#!/bin/sh
# Downloads the three OFL fonts the film uses into demo/fonts/ when they are missing (Google Fonts repository).
set -e
F=$(cd "$(dirname "$0")/.." && pwd)/fonts
get() { [ -s "$F/$1" ] || { echo "fetching $1"; curl -fsSL --retry 3 -o "$F/$1" "https://github.com/google/fonts/raw/main/ofl/$2"; }; }
get BigShouldersDisplaywght.ttf 'bigshouldersdisplay/BigShouldersDisplay%5Bwght%5D.ttf'
get Outfitwght.ttf 'outfit/Outfit%5Bwght%5D.ttf'
get NotoSansSCwght.ttf 'notosanssc/NotoSansSC%5Bwght%5D.ttf'
