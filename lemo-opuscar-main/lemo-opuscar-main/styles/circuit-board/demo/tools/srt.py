"""Bilingual subtitles for the film: one cue per spoken line, a Chinese line over an English line, timed like the
subtitle bar the page draws (from each line's start in events.json to the end of its voice file).
Run:  python3 <demo>/tools/srt.py <demo> <out.srt>"""
import json, os, sys
D, OUT = sys.argv[1], sys.argv[2]
ev = {e['id']: e for e in json.load(open(os.path.join(D, 'events.json')))['ev'] if e['type'] == 'vo'}
cn = {l['id']: l['text'] for l in json.load(open(os.path.join(D, 'voice/lines.json'), encoding='utf-8'))}
en = dict(json.load(open(os.path.join(D, 'data/subs_en.json'), encoding='utf-8')))
dur = json.load(open(os.path.join(D, 'voice/dur.json')))
ts = lambda t: '%02d:%02d:%02d,%03d' % (t // 3600, t % 3600 // 60, t % 60, round((t - int(t)) * 1000) % 1000)
out = []
for i, k in enumerate(sorted(ev, key=lambda k: ev[k]['t'])):
    t0, t1 = ev[k]['t'] - 0.05, ev[k]['t'] + dur[k] + 0.12
    out.append(f'{i + 1}\n{ts(t0)} --> {ts(t1)}\n{cn[k]}\n{en[k]}\n')
open(OUT, 'w', encoding='utf-8').write('\n'.join(out))
print(OUT, len(out), 'cues')
