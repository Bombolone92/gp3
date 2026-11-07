#!/bin/sh
# 0.5 s contact sheet at 960x540 into out/sheet.jpg (run from anywhere)
HERE=$(cd "$(dirname "$0")/.." && pwd); LIB=${LIB:-$(cd "$HERE/../../.." && pwd)}; cd "$LIB"
rm -rf "$HERE/out/sheet"; mkdir -p "$HERE/out"
node core/render/still.mjs "$HERE" --range 0:60:0.5 --size 960x540 --out "$HERE/out/sheet" --prefix s_ > /dev/null || exit 1
.venv/bin/python core/render/sheet.py "$HERE/out/sheet.jpg" $(cd "$HERE/out/sheet" && ls s_*.jpg | sort -t_ -k2 -n | sed "s#^#$HERE/out/sheet/#") --cols 8 --w 240
