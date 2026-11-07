"""The shot timeline in film.js is built from the Chinese line lengths (VO_DUR). After a fresh narration run, check that
   out/vo_zh/dur.json still matches (edge-tts can drift by a few milliseconds; more than 0.08 s means: update VO_DUR)."""
import json, os, re, sys
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
got = json.load(open(os.path.join(D, 'out', 'vo_zh', 'dur.json')))
want = [float(x) for x in re.search(r'const VO_DUR = \[([^\]]*)\]', open(os.path.join(D, 'film.js'), encoding='utf-8').read()).group(1).split(',')]
bad = [(f'V{i + 1:02d}', w, got[f'V{i + 1:02d}']) for i, w in enumerate(want) if abs(got[f'V{i + 1:02d}'] - w) > .08]
for b in bad: print('line %s: film.js %.3f s, voice %.3f s' % b)
print('voice lengths match VO_DUR' if not bad else 'update VO_DUR in film.js to the voice lengths above'); sys.exit(1 if bad else 0)
