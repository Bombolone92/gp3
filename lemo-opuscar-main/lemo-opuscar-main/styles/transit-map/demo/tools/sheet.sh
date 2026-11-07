#!/bin/sh
# Contact sheet every 0.5 s at 960x540, for review. Run from the library root: sh styles/transit-map/demo/tools/sheet.sh
D=styles/transit-map/demo
rm -rf $D/out/sheet
node core/render/still.mjs $D --range 0:47:0.5 --size 960x540 --out $D/out/sheet --prefix s_ | tail -1
.venv/bin/python core/render/sheet.py $D/out/sheet.jpg $(ls $D/out/sheet/s_*.jpg | awk -F/ '{print $NF" "$0}' | sort -t_ -k2 -g | cut -d' ' -f2) --cols 8 --w 240
