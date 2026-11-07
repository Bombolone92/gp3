"""Fetch the two OFL fonts this demo uses into demo/fonts/ (they are not in git):
Cormorant Garamond (variable) from the Google Fonts repository, and Noto Serif SC (variable), subset to the characters
the film draws (subtitles, titles, the end card). python tools/fonts.py   (needs fontTools: the library's .venv has it)"""
import json, os, sys, urllib.request
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(HERE, 'fonts'); os.makedirs(F, exist_ok=True)
RAW = 'https://github.com/google/fonts/raw/main/ofl/'
def get(url, dst):
    if not os.path.exists(dst): print('fetch', url); urllib.request.urlretrieve(url, dst)
get(RAW + 'cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf', os.path.join(F, 'CormorantGaramond-VF.ttf'))
get(RAW + 'cormorantgaramond/OFL.txt', os.path.join(F, 'OFL-CormorantGaramond.txt'))
get(RAW + 'notoserifsc/OFL.txt', os.path.join(F, 'OFL-NotoSerifSC.txt'))
sub = os.path.join(F, 'NotoSerifSC-sub.ttf')
if not os.path.exists(sub):
    full = os.path.join(F, 'NotoSerifSC-VF.ttf')
    get(RAW + 'notoserifsc/NotoSerifSC%5Bwght%5D.ttf', full)
    tl = json.load(open(os.path.join(HERE, 'timeline.json'), encoding='utf-8'))
    chars = ''.join(sorted(set(''.join(c['zh'] for c in tl['cues']) + '末班夜车纸雕灯影风格车')))
    from fontTools import subset
    subset.main([full, f'--text={chars}', '--unicodes=U+0020-007E,U+00D7,U+2192,U+3000-303F,U+FF01-FF5E', f'--output-file={sub}'])
    os.remove(full)
print('fonts ok')
