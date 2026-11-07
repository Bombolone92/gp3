"""Subset Noto Sans SC (OFL) to every character the film shows: card print, screens, pills and the subtitles (src/*.js, index.html).
Run from the library root:  .venv/bin/python styles/desktop-flythrough/demo/tools/subset.py"""
import os, glob
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
txt = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(D, 'src', '*.js')) + [os.path.join(D, 'index.html')])
chars = sorted(set(ch for ch in txt if ord(ch) > 0x2000) | set('0123456789:,.?!-+()·×→←✓≈‹，。：、'))
open(os.path.join(HERE, 'chars.txt'), 'w', encoding='utf-8').write(''.join(chars))
from fontTools import subset
subset.main([os.path.join(HERE, 'NotoSansSC-VF.ttf'), '--text-file=' + os.path.join(HERE, 'chars.txt'), '--output-file=' + os.path.join(D, 'fonts', 'NotoSansSC-sub.ttf'), '--layout-features=*', '--no-hinting'])
print(len(chars), 'chars')
