"""Subset Noto Sans SC (OFL) to the characters the film prints. Run from the library root:
   .venv/bin/python styles/transit-map/demo/tools/subset.py"""
import os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
txt = ''.join(open(os.path.join(D, f), encoding='utf-8').read() for f in ['net.js', 'film.js', 'timeline.js'])
chars = sorted(set(ch for ch in txt if ord(ch) > 0x2E7F) | set('0123456789·→×—–≈年'))
open(os.path.join(HERE, 'chars.txt'), 'w', encoding='utf-8').write(''.join(chars))
from fontTools import subset
args = [os.path.join(HERE, 'NotoSansSC-VF.ttf'), '--text-file=' + os.path.join(HERE, 'chars.txt'), '--output-file=' + os.path.join(D, 'fonts', 'NotoSansSC-sub.ttf'), '--layout-features=*', '--no-hinting']
subset.main(args)
print(len(chars), 'chars')
