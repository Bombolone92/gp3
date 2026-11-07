"""Is the ground under every subtitle dark? For each cue, one frame at its middle: in the subtitle box, the share of
non-text pixels darker than L 0.35 (text = bright and unsaturated). python tools/subcheck.py film.mp4 [offset]"""
import json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
film, off = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0
cues = json.load(open(os.path.join(HERE, 'timeline.json')))['cues']
worst = 1
for c in cues:
    t = (c['t0'] + c['t1']) / 2 - off
    if t < 0: continue
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', film, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    if len(raw) < 1920 * 1080 * 3: continue
    im = np.frombuffer(raw, np.uint8).reshape(1080, 1920, 3) / 255.
    box = im[930:1025, 720:1200]
    L = box @ np.array([.2126, .7152, .0722]); sat = box.max(2) - box.min(2)
    text = (L > .55) & (sat < .2)
    dark = ((L < .35) & ~text).sum() / max(1, (~text).sum())
    worst = min(worst, dark)
    print(f"{c['id']:4} {t:6.2f}s  dark {dark * 100:5.1f}%  {c['en']}")
print('worst', round(worst * 100, 1), '%')
