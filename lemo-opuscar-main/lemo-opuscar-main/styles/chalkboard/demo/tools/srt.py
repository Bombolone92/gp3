"""<slug>.srt from the subtitle cues the page exports into events.json (type 'sub': t, t1, zh, en): one Chinese line and one
English line per cue, timed with the voice. usage: python styles/chalkboard/demo/tools/srt.py <out.srt>"""
import os, sys, json
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ev = json.load(open(os.path.join(HERE, 'events.json')))['ev']
cues = sorted((e for e in ev if e['type'] == 'sub'), key=lambda e: e['t'])
ts = lambda x: '%02d:%02d:%02d,%03d' % (x // 3600, x % 3600 // 60, x % 60, round(x % 1 * 1000) % 1000)
out = []
for k, e in enumerate(cues):
    t1 = min(e['t1'], cues[k + 1]['t']) if k + 1 < len(cues) else e['t1']
    out.append(f"{k + 1}\n{ts(max(0, e['t']))} --> {ts(t1)}\n{e['zh']}\n{e['en']}\n")
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out))
print(f'{sys.argv[1]}: {len(cues)} cues')
