"""Noto Serif SC (OFL) at weight 700, subset to every character the film prints, as fonts/NotoSerifSC-700.woff2.
Run from the library root:  .venv/bin/python styles/printed-long-take/demo/tools/subset.py
Needs tools/NotoSerifSC-VF.ttf (build.sh downloads it from github.com/google/fonts). Only kern and palt are kept:
with every layout feature kept, some browsers pick a locale variant of a character (a traditional crane for 鹤)."""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
txt = ''.join(open(os.path.join(D, f), encoding='utf-8').read() for f in ['scene.js', 'props.js', 'timeline.js'])
chars = sorted(set(c for c in txt if ord(c) > 0x7E) | set(chr(i) for i in range(0x20, 0x7F)) | set('’−°×·'))
open(os.path.join(HERE, 'chars.txt'), 'w', encoding='utf-8').write(''.join(chars))
tmp = os.path.join(HERE, 'NotoSerifSC-700.ttf')
instancer.instantiateVariableFont(TTFont(os.path.join(HERE, 'NotoSerifSC-VF.ttf')), {'wght': 700}).save(tmp)
subset.main([tmp, '--text-file=' + os.path.join(HERE, 'chars.txt'), '--flavor=woff2', '--layout-features=kern,palt',
             '--output-file=' + os.path.join(D, 'fonts', 'NotoSerifSC-700.woff2')])
os.remove(tmp)
print(len(chars), 'chars')
