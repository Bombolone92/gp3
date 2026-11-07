"""fonts/wenkai-sub.woff2: LXGW WenKai (OFL) cut down to the characters the subtitles use (every string in SUB in js/film.js)
plus printable ASCII. The chalk writing on the board is our own stroke data and needs no font.
usage: python styles/chalkboard/demo/tools/subset.py"""
import os, re
from fontTools import subset
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(HERE, 'js/film.js'), encoding='utf-8').read()
i = src.index('export const SUB = {'); j = src.index('};', i)
block = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), src[i:j])
chars = {c for c in block if not c.isspace()} | set('汉字的故事’‘“”…·→←×') | {chr(c) for c in range(0x20, 0x7f)}
opt = subset.Options(); opt.flavor = 'woff2'; opt.layout_features = ['*']
font = subset.load_font(os.path.join(HERE, 'fonts/LXGWWenKai-Regular.ttf'), opt)
s = subset.Subsetter(opt); s.populate(text=''.join(sorted(chars))); s.subset(font)
cmap = font.getBestCmap(); miss = sorted(c for c in chars if ord(c) not in cmap and c != ' ')
if miss: raise SystemExit('subset.py: the font has no glyph for ' + ''.join(miss))
subset.save_font(font, os.path.join(HERE, 'fonts/wenkai-sub.woff2'), opt)
print(f'wenkai-sub.woff2: {len(chars)} characters')
