"""Bilingual subtitles (one Chinese line, one English line per cue) timed like the bar in the picture.
Run from the library root:  .venv/bin/python styles/printed-long-take/demo/tools/srt.py  → ../printed-long-take.srt
The cue times follow scene.js: each line from its start to the end of the Chinese reading + 0.45 s (not past the next line),
then mapped through the bridge slow-down (WARP in scene.js, mirrored in audio.py)."""
import os, re, json
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
src = open(os.path.join(D, 'timeline.js'), encoding='utf-8').read()
DUR = float(re.search(r'DUR: ([\d.]+)', src).group(1))
VO = [(m[0], float(m[1]), m[2], m[3].replace('\\u2019', '’')) for m in re.findall(r"\['(l\d\d)', ([\d.]+), '([^']*)', '((?:[^'\\]|\\.)*)'\]", src)]
dur = json.load(open(os.path.join(D, 'voice', 'zh', 'dur.json')))
s = open(os.path.join(D, 'scene.js'), encoding='utf-8').read()
a, b, d = map(float, re.search(r'const WARP = \{ a: ([\d.]+), b: ([\d.]+), d: ([\d.]+) \}', s).groups())
import math
def old(t):
    if t <= a: return t
    if t >= b: return t - d
    u = (t - a) / (b - a); return t - d * (u - math.sin(2 * math.pi * u) / (2 * math.pi))
def new(x):
    if x <= a: return x
    lo, hi = x, x + d
    for _ in range(50):
        m = (lo + hi) / 2
        lo, hi = (m, hi) if old(m) < x else (lo, m)
    return (lo + hi) / 2
ts = lambda t: f'{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round(t % 1 * 1000)) % 1000:03d}'
out = []
for i, (id_, at, cn, en) in enumerate(VO):
    nxt = VO[i + 1][1] if i + 1 < len(VO) else DUR
    s0, s1 = new(at - .05), new(min(at + dur[id_] + .45, nxt - .1))
    out.append(f'{i + 1}\n{ts(s0)} --> {ts(s1)}\n{cn}\n{en}\n')
open(os.path.join(os.path.dirname(D), 'printed-long-take.srt'), 'w', encoding='utf-8').write('\n'.join(out))
print(len(out), 'cues')
