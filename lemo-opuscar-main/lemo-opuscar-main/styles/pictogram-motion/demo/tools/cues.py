"""Subtitle cues from voice/vo.json (start times) + out/voice/dur.json (TTS lengths).
Writes voice/cues.js (for the page) and an .srt for the span [a, b] (film seconds); default ../pictogram-motion.srt.
usage: cues.py [a b out.srt]"""
import json, sys, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
vo = json.load(open(f'{HERE}/voice/vo.json'))
dur = json.load(open(f'{HERE}/out/voice/dur.json'))
cues = []
for i, v in enumerate(vo):
    d = dur[v['id']]
    t1 = max(v['t'] + 1.8, v['t'] + d + 0.6)
    if i + 1 < len(vo): t1 = min(t1, vo[i + 1]['t'] - 0.15)
    assert t1 - v['t'] >= max(1.8, d + 0.6) - 1e-6, (v['id'], 'subtitle too short')
    cues.append(dict(id=v['id'], t0=v['t'], t1=round(t1, 3), vo_end=round(v['t'] + d, 3), en=v['en'], zh=v['zh']))
open(f'{HERE}/voice/cues.js', 'w').write('window.CUES = ' + json.dumps(cues, ensure_ascii=False, indent=1) + ';\n')
a = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
b = float(sys.argv[2]) if len(sys.argv) > 2 else 1e9
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(HERE), 'pictogram-motion.srt')
def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
n, lines = 0, []
for c in cues:
    if c['t1'] <= a or c['t0'] >= b: continue
    n += 1
    lines += [str(n), f"{ts(max(c['t0'], a) - a)} --> {ts(min(c['t1'], b) - a)}", c['zh'], c['en'], '']
open(out, 'w').write('\n'.join(lines))
print('cues', len(cues), '→', out, n, 'in span')
