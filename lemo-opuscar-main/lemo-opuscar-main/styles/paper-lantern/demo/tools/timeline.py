"""The Last Night Train — the one timeline: narration starts, bilingual cues, hit points, shot list.
python3 tools/timeline.py [film.srt] [cut.srt]  → timeline.json (+ subtitles)"""
import json, os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dur = json.load(open(os.path.join(HERE, 'voices/dur.json')))
lines = json.load(open(os.path.join(HERE, 'voices/lines.json')))
AT = {'L1': 1.0, 'L2a': 10.6, 'L2b': 12.6, 'L3a': 16.2, 'L3b': 18.25, 'L4': 22.4, 'L5a': 27.3, 'L5b': 31.0, 'L6': 35.8, 'L7': 41.6, 'L8': 45.7}
ZH = {'L1': '今夜，这列老夜车跑最后一趟。', 'L2a': '从雪山，', 'L2b': '一路开到海边。',
      'L3a': '40 年来，', 'L3b': '它在沿线每个小站都停。', 'L4': '然后，是那条长长的隧道。',
      'L5a': '出了隧道，雪不见了，', 'L5b': '沿河的小镇都为它亮着灯。',
      'L6': '线路的尽头，大海在等它。', 'L7': '车窗一扇一扇暗了下去。', 'L8': '可站台的灯还亮着，等下一班车。'}
EN = {'L3a': 'For 40 years,'}
L = {l['id']: {'at': AT[l['id']], 'dur': dur[l['id']], 'end': round(AT[l['id']] + dur[l['id']], 3), 'en': EN.get(l['id'], l['text']), 'zh': ZH[l['id']]} for l in lines}
DUR = 51.0
ids = list(AT); cues = []
for n, i in enumerate(ids):
    t0, t1 = L[i]['at'] - .15, max(L[i]['at'] + 1.8, L[i]['end'] + .6)
    if n + 1 < len(ids): t1 = min(t1, L[ids[n + 1]]['at'] - .16)
    else: t1 = DUR + .3   # the last line stays to the end of the film (no fade under the end card)
    cues.append({'id': i, 't0': round(t0, 3), 't1': round(t1, 3), 'zh': ZH[i], 'en': L[i]['en']})
HIT = {
    'lamp': .4,                                   # the halt's lamp flickers on
    'cars': [1.5 + k * .34 for k in range(8)],    # the windows light up car by car, engine first
    'head': 5.25, 'horn': 5.5, 'depart': 5.9,     # headlight, the horn, wheels start
    'sign': 7.5,                                  # 10 s cut only: the credit strip grows
    'portal': 25.3, 'dark': [25.5, 25.75],        # the tunnel: a blink of true dark and silence (0.25 s), then the river
    'stop': 41.0, 'off': [42.0 + k * .42 for k in range(7)] + [45.75],   # the terminus: windows go out one by one; the last one holds a beat, then goes
    'card': 47.5,
}
DUR = 51.0
SHOTS = [['S1', 0.0, None], ['S2', 13.8, 'dissolve'], ['S3', 22.0, 'dissolve'], ['S4', 25.75, 'cut'], ['S5', 35.4, 'dissolve'], ['S6', 40.2, 'dissolve']]
CUT = [0.0, 10.0]
json.dump({'DUR': DUR, 'L': L, 'cues': cues, 'HIT': HIT, 'SHOTS': SHOTS, 'CUT': CUT}, open(os.path.join(HERE, 'timeline.json'), 'w'), indent=1, ensure_ascii=False)
def fmt(s): ms = int(round(max(0, s) * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
def srt(cs, off, p): open(p, 'w', encoding='utf-8').write('\n'.join(f"{k + 1}\n{fmt(c['t0'] - off)} --> {fmt(min(c['t1'], DUR) - off)}\n{c['zh']}\n{c['en']}\n" for k, c in enumerate(cs)))
srt(cues, 0, sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'demo-full.srt'))
if len(sys.argv) > 2: srt([dict(c, t0=max(c['t0'], CUT[0]), t1=min(c['t1'], CUT[1])) for c in cues if c['t1'] > CUT[0] + .3 and c['t0'] < CUT[1] - .3], CUT[0], sys.argv[2])
print('timeline.json DUR', DUR, 'min hold', min(round(c['t1'] - c['t0'], 2) for c in cues))
for c in cues: print(f"  {c['id']:4} {c['t0']:6.2f}–{c['t1']:6.2f}  {c['en']}")
