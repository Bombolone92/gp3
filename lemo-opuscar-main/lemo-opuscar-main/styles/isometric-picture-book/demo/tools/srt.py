"""Bilingual subtitles (one Chinese line, one English line per narration line), timed exactly as the page shows them.
   .venv/bin/python styles/isometric-picture-book/demo/tools/srt.py   → styles/isometric-picture-book/isometric-picture-book.srt"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE); FILM = os.path.dirname(D)
tl = next(e for e in json.load(open(os.path.join(D, 'events.json')))['ev'] if e['type'] == 'timeline')
cn = [l['text'] for l in json.load(open(os.path.join(D, 'lines.json'), encoding='utf-8'))]
en = [l['text'] for l in json.load(open(os.path.join(D, 'lines_en.json'), encoding='utf-8'))]
VO, VD = tl['VO'], tl['VO_DUR']
cues = [{'t0': VO[i] - .05, 't1': VO[i] + VD[i] + .12, 'text': cn[i] + '\n' + en[i]} for i in range(len(VO))]
for i in range(len(cues) - 1): cues[i]['t1'] = min(cues[i]['t1'], cues[i + 1]['t0'] - .1)   # one cue at a time (as kit.js shows them)
tmp = os.path.join(D, 'out', 'cues.json'); os.makedirs(os.path.dirname(tmp), exist_ok=True)
json.dump(cues, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
subprocess.run([sys.executable, 'core/render/srt.py', tmp, os.path.join(FILM, os.path.basename(FILM) + '.srt')], check=True)
