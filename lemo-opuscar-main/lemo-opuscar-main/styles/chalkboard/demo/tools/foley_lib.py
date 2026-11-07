"""Slice real chalk recordings (CC0 / CC BY, see CREDITS) into a tagged grain library for mix.py.
usage: python -I tools/foley_lib.py <out_dir> <src_name>=<file> [...]
Writes <out_dir>/<kind>_<src>_<n>.wav (48 kHz mono, normalised) and <out_dir>/index.json with per-grain features.
kinds: tap (short, sharp attack), stroke (a continuous scrape), squeak (a strong tone between 1.4 and 5 kHz)."""
import sys, os, json
import numpy as np, soundfile as sf, soxr
from scipy.signal import butter, sosfilt
SR = 48000
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
srcs = [a.split('=', 1) for a in sys.argv[2:]]
hp = lambda x, f: sosfilt(butter(2, f, 'high', fs=SR, output='sos'), x)
lib = []
for name, path in srcs:
    y, sr = sf.read(path, always_2d=True); y = y.mean(1).astype(np.float64)
    if sr != SR: y = soxr.resample(y, sr, SR)
    y = hp(y, 70); y /= np.abs(y).max() + 1e-12
    hop = int(.002 * SR); n = len(y) // hop
    env = np.array([np.sqrt(np.mean(y[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    sm = np.convolve(env, np.ones(5) / 5, 'same')
    floor = np.percentile(sm, 15) + 1e-9
    act = sm > floor * 5
    # merge gaps shorter than 24 ms, drop blips shorter than 8 ms
    segs, i = [], 0
    while i < n:
        if not act[i]: i += 1; continue
        j = i
        while j < n and (act[j] or (j + 12 < n and act[j:j + 12].any())): j += 1
        if j - i >= 4: segs.append((i, j))
        i = j + 1
    for k, (a, b) in enumerate(segs):
        s0, s1 = max(0, a * hop - int(.004 * SR)), min(len(y), b * hop + int(.01 * SR))
        x = y[s0:s1].copy(); d = len(x) / SR
        if d < .012: continue
        e = env[a:b]; pk = int(np.argmax(e)); attack = pk * hop / SR
        crest = float(np.abs(x).max() / (np.sqrt(np.mean(x ** 2)) + 1e-12))
        X = np.abs(np.fft.rfft(x * np.hanning(len(x)), n=1 << int(np.ceil(np.log2(max(len(x), 2048))))))
        f = np.fft.rfftfreq((len(X) - 1) * 2, 1 / SR)
        cen = float((X * f).sum() / (X.sum() + 1e-12))
        band = (f > 1400) & (f < 5000)
        tonal = float(20 * np.log10(X[band].max() / (np.median(X[band]) + 1e-12))) if band.any() else 0
        fpk = float(f[band][np.argmax(X[band])]) if band.any() else 0
        lo = float(X[(f > 80) & (f < 600)].sum() / (X.sum() + 1e-12))
        kind = 'squeak' if tonal > 30 and d > .05 else ('tap' if d < .09 and attack < .012 else 'stroke')
        fade = min(len(x) // 4, int(.006 * SR)); x[:fade] *= np.linspace(0, 1, fade); x[-fade:] *= np.linspace(1, 0, fade)
        x = x / (np.abs(x).max() + 1e-12) * .9
        fn = f'{kind}_{name}_{k:03d}.wav'; sf.write(os.path.join(out, fn), x.astype(np.float32), SR)
        lib.append({'file': fn, 'src': name, 'kind': kind, 'dur': round(d, 4), 'attack': round(attack, 4), 'crest': round(crest, 2),
                    'centroid': round(cen), 'tonal_db': round(tonal, 1), 'tone_hz': round(fpk), 'low': round(lo, 3),
                    'rms': round(float(20 * np.log10(np.sqrt(np.mean(y[s0:s1] ** 2)) + 1e-12)), 1), 'at': round(s0 / SR, 3)})
json.dump(lib, open(os.path.join(out, 'index.json'), 'w'), indent=0)
from collections import Counter
print(len(lib), 'grains', Counter((g['src'], g['kind']) for g in lib))
for kd in ('tap', 'stroke', 'squeak'):
    ds = [g['dur'] for g in lib if g['kind'] == kd]
    if ds: print(kd, 'dur min/median/max', round(min(ds), 3), round(float(np.median(ds)), 3), round(max(ds), 3))
