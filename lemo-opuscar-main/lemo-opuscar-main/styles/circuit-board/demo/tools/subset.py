"""Subtitle font: Noto Sans SC (OFL) at weight 500, cut down to the characters the subtitles use.
Run with the library venv:  .venv/bin/python -I <demo>/tools/subset.py <demo>
Reads tools/NotoSansSC-VF.ttf (build.sh downloads it), voice/lines.json and data/subs_en.json.
Writes fonts/NotoSansSC-Medium-sub.ttf. The board's own lettering is drawn in code (src/font.js, src/hanzi.js)."""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
D = sys.argv[1]
cn = ''.join(l['text'] for l in json.load(open(os.path.join(D, 'voice/lines.json'), encoding='utf-8')))
en = ''.join(t for _, t in json.load(open(os.path.join(D, 'data/subs_en.json'), encoding='utf-8')))
chars = {c for c in cn + en + '0123456789,.·×→≈~' if c.strip()}
f = TTFont(os.path.join(D, 'tools/NotoSansSC-VF.ttf'))
instantiateVariableFont(f, {'wght': 500}, inplace=True)
opt = subset.Options(); opt.name_IDs = ['*']; opt.notdef_outline = True
s = subset.Subsetter(opt); s.populate(unicodes=[ord(c) for c in chars] + [0x20]); s.subset(f)
f.save(os.path.join(D, 'fonts/NotoSansSC-Medium-sub.ttf'))
cmap = f.getBestCmap(); miss = sorted(c for c in chars if ord(c) not in cmap)
print('subtitle font:', len(cmap), 'glyphs', '(missing: ' + ''.join(miss) + ')' if miss else '')
sys.exit(1 if miss else 0)
