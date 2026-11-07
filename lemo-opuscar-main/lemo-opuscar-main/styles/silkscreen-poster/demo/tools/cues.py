"""cues.py · subtitle cues from voice/subs.json (start times) + out/voice/dur.json (spoken lengths, written by core/tts/tts.py).
Writes voice/cues.json (read by the page) and an .srt for the chosen range.
  python tools/cues.py [a b out.srt]   (default: whole film → ../silkscreen-poster.srt)
Rule: a cue opens 0.1 s before its line and stays ≥ 1.8 s and ≥ speech + 0.6 s, but closes 0.04 s before the next one."""
import json, os, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(D, 'voice/subs.json'))); dur = json.load(open(os.path.join(D, 'out/voice/dur.json')))
cues = []
for i, s in enumerate(S):
    vo = s['t']; t0 = round(vo - .1, 3); t1 = max(t0 + 1.8, vo + dur[s['id']] + .6)
    if i + 1 < len(S): t1 = min(t1, S[i + 1]['t'] - .1 - .04)
    short = t1 - t0 < max(1.8, dur[s['id']] + .6) - 1e-6
    cues.append({'id': s['id'], 'vo': vo, 't0': t0, 't1': round(t1, 3), 'zh': s['zh'], 'en': s['en'], 'speech': dur[s['id']]})
    if short: print('WARNING: cue too short', s['id'], round(t1 - t0, 2))
json.dump(cues, open(os.path.join(D, 'voice/cues.json'), 'w'), ensure_ascii=False, indent=1)
a, b = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) > 2 else (0, 1e9)
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(D), 'silkscreen-poster.srt')
def ts(x): x = max(0, x); h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f'{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}'
lines = []; n = 0
for c in cues:
    if c['t1'] <= a or c['t0'] >= b: continue
    n += 1; lines += [str(n), f"{ts(c['t0'] - a)} --> {ts(min(c['t1'], b) - a)}", c['zh'], c['en'], '']
open(out, 'w').write('\n'.join(lines))
for c in cues: print(f"{c['id']} {c['t0']:6.2f}–{c['t1']:6.2f}  hold {c['t1']-c['t0']:.2f}s  speech {c['speech']:.2f}s")
print('srt →', out)
