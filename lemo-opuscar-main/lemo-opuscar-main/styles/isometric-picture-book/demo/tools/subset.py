"""Subset Noto Serif SC (OFL) to the characters the film prints and the subtitles say. Run from the library root:
   .venv/bin/python styles/isometric-picture-book/demo/tools/subset.py"""
import os
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
txt = ''.join(open(os.path.join(D, f), encoding='utf-8').read() for f in ['film.js', 'places.js', 'plane.js', 'kit.js', 'lines.json'])
chars = sorted(set(ch for ch in txt if ord(ch) > 0x2E7F) | set('0123456789:·×–，。？：、'))
open(os.path.join(HERE, 'chars.txt'), 'w', encoding='utf-8').write(''.join(chars) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,-')
from fontTools import subset
subset.main([os.path.join(HERE, 'NotoSerifSC-VF.ttf'), '--text-file=' + os.path.join(HERE, 'chars.txt'),
             '--output-file=' + os.path.join(D, 'fonts', 'NotoSerifSC-sub.ttf'), '--layout-features=*', '--no-hinting'])
print(len(chars), 'chars')
