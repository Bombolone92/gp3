"""Seven Milliseconds — score, sound design and mix, all synthesised (no samples, no piano, no strings).
Run from the library root:  .venv/bin/python styles/circuit-board/demo/audio.py [en]
(with `en`: the same score and effects under the English voice from voice_en/, written to mix_en.wav)
Reads events.json (node core/render/events.mjs <film>). Writes mix.wav (48 kHz stereo, exactly the film's length).

Key G, 100 BPM, tuned to the mains: the 50 Hz hum sits on G1 (49 Hz).
The rule the ear follows: AC = a gated tremolo tone, DC = one steady long tone. The water turns into the hum,
the hum is chopped (AC), the bridge smooths it (DC); the same happens again, two octaves up, inside the charger.
"""
import json, os, sys, subprocess
import numpy as np
import soundfile as sf
from scipy.signal import sawtooth

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, os.path.join(LIB, 'core/audio'))
import sfx  # noqa: E402
from sfx import SR, t_, bp, lp, hp, noise, add  # noqa: E402

LANG = sys.argv[1] if len(sys.argv) > 1 else 'zh'
VODIR, OUTNAME = ('voice_en', 'mix_en.wav') if LANG == 'en' else ('voice', 'mix.wav')
EV = json.load(open(os.path.join(HERE, 'events.json')))
EV = EV['ev'] if isinstance(EV, dict) else EV
DUR = 60.0; N = int(DUR * SR)
BEAT = 60 / 100; S16 = BEAT / 4
rng = np.random.default_rng(7)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def buf(): return np.zeros((N, 2), np.float32)
def ev(ty): return [e for e in EV if e['type'] == ty]
def fade(x, a=0.01, b=0.05):
    n = len(x); ia, ib = min(n, int(a * SR)), min(n, int(b * SR))
    if ia: x[:ia] *= np.linspace(0, 1, ia)
    if ib: x[-ib:] *= np.linspace(1, 0, ib)
    return x

# ---------------- voices ----------------
def tone(m, d, bright=0.3):           # a soft synth tone: sine + a little saw, low-passed
    tt = t_(d); f = hz(m)
    return lp(np.sin(2 * np.pi * f * tt) * 0.8 + sawtooth(2 * np.pi * f * tt) * bright, min(9000, f * 6))
def gate(x, rate, depth=0.85, ph=0.0):  # AC: amplitude gated at `rate` Hz
    tt = np.arange(len(x)) / SR; g = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * rate * tt + ph))
    from scipy.ndimage import uniform_filter1d
    g = uniform_filter1d(g, int(0.006 * SR)); return x * (1 - depth + depth * g)
def bell(m, d=1.6, ratio=3.5, idx=1.8):
    tt = t_(d); f = hz(m); I = idx * np.exp(-tt / 0.3)
    return np.sin(2 * np.pi * f * tt + I * np.sin(2 * np.pi * f * ratio * tt)) * np.exp(-tt / 0.6) * np.minimum(1, tt / 0.002)
def glock(m, d=1.2):
    tt = t_(d); f = hz(m); return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.08)) * np.exp(-tt / 0.45) * np.minimum(1, tt / 0.001)
def relay(pitch=1.0):
    x = np.zeros(int(0.06 * SR)); c = sfx.click(1.3 * pitch, 1.0); x[:len(c)] += c[:len(x)]
    c2 = sfx.click(1.0 * pitch, 0.6); s = int(0.011 * SR); x[s:s + len(c2)] += c2[:len(x) - s]; return x
def kick():
    d = 0.4; tt = t_(d); f = 46 + 70 * np.exp(-tt / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.17)
def tick(v=1.0):
    d = 0.03; tt = t_(d); return bp(noise(d), 5000, 11000) * np.exp(-tt / 0.0025) * v
def arp(m, d=0.14, cut=3000):
    tt = t_(d); f = hz(m); x = sawtooth(2 * np.pi * f * tt, 0.5) * np.minimum(1, tt / 0.003) * np.exp(-tt / 0.08)
    return lp(x, cut)
def pad(ms, d, att=1.2, rel=1.4, cut=1600):
    tt = t_(d); x = np.zeros_like(tt)
    for m in ms:
        for c in (-6, 0, 6): x += sawtooth(2 * np.pi * hz(m) * 2 ** (c / 1200) * tt + rng.random() * 6)
    e = np.minimum(1, tt / att) * np.minimum(1, np.maximum(0, d - tt) / rel)
    return lp(lp(x / (3 * len(ms)), cut), cut) * e
def hum(d, v=1.0):
    tt = t_(d); f = hz(31)        # G1 ≈ 49 Hz: the mains, tuned to the key
    return (0.6 * np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(4 * np.pi * f * tt) + 0.3 * np.sin(6 * np.pi * f * tt) + 0.15 * np.sin(8 * np.pi * f * tt)) * v
def sub_hit(d=1.4, f0=80, f1=34):
    tt = t_(d); f = f1 + (f0 - f1) * np.exp(-tt / 0.15); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.5) * np.minimum(1, tt / 0.003)

mus, fx, amb = buf(), buf(), buf()
T_IN, T_ARR, T_AC, T_DB, PULL0 = 16.3, 23.0, 27.4, 39.4, 52.9

# ---------------- 0–4.7: water, sixteen units, the water becomes the hum ----------------
d = 5.2; tt = t_(d)
roar = lp(noise(d), 900) * 0.7 + bp(noise(d), 900, 5000) * 0.3
cut_env = np.clip(1 - (tt - 4.2) / 0.9, 0, 1)
add(amb, fade(roar * np.minimum(1, tt / 0.02) * (0.65 + 0.35 * cut_env) * np.where(tt > 4.2, cut_env, 1)), 0.0, 0.10)
add(fx, hp(sub_hit(1.5, 70, 30), 40) + lp(noise(1.5), 300) * np.exp(-t_(1.5) / 0.2) * 0.6, 0.0, 0.3)
for e in ev('gen'):
    add(fx, relay(1.0 + 0.045 * e['i']), e['t'], 0.16, -0.5 if e['i'] % 2 else 0.5)
    add(mus, glock(67 + [0, 2, 4, 7, 9, 12, 14, 16][(e['i'] // 2) % 8]), e['t'], 0.025, 0.3 if e['i'] % 2 else -0.3)
add(amb, fade(hum(T_ARR - 4.2, 1.0) * np.minimum(1, t_(T_ARR - 4.2) / 0.8)), 4.2, 0.03)
# AC = a gated tone. Normal rate until 5.4, slow while the voice explains it (5.4–10.1), normal again
def ac_tone(t0, t1, m, rate, g, cut=None):
    d = t1 - t0; x = gate(tone(m, d, 0.25) + tone(m + 7, d, 0.15) * 0.6, rate, 0.8)
    if cut is not None: x = x * cut(t_(d))
    add(mus, fade(x, 0.05, 0.08), t0, g)
ac_tone(2.2, 5.4, 43, 100 / 60 * 4, 0.10)
ac_tone(5.4, 10.1, 43, 1.1, 0.10)
ac_tone(10.1, 14.4, 43, 100 / 60 * 4, 0.10, lambda tt: np.exp(-tt / 2.2))           # the loss: it dies away along the line
ac_tone(14.4, T_IN, 43, 100 / 60 * 4, 0.10)

# ---------------- Butuo: the tremolo smooths into one steady tone (DC); the groove starts ----------------
d = T_ARR + 0.1 - T_IN; x = (tone(43, d, 0.2) + tone(50, d, 0.1) * 0.5) * np.minimum(1, t_(d) / 0.04); add(mus, fade(x, 0.005, 0.05), T_IN, 0.09)
for e in ev('smooth'): add(fx, fade(bp(noise(0.25), 600, 6000) * np.exp(-t_(0.25) / 0.05)), e['t'], 0.08)
for i in range(int(T_IN / BEAT) + 1, int(T_ARR / BEAT)):
    tb = i * BEAT
    if 18.75 <= tb < 19.1: continue
    add(mus, hp(kick(), 48), tb, 0.12)
for i in range(int(T_IN / S16) + 1, int(T_ARR / S16)):
    add(mus, tick(1.0 if i % 4 == 0 else 0.5), i * S16, 0.035, 0.3 if i % 2 else -0.3)
BASS = [43, 43, 46, 41]
for i in range(int(T_IN / (BEAT / 2)) + 1, int(T_ARR / (BEAT / 2))):
    tb = i * BEAT / 2; m = BASS[int(tb // (4 * BEAT)) % 4] - 12
    d = 0.26; x = lp(sawtooth(2 * np.pi * hz(m) * t_(d), 0.4), 700) * np.minimum(1, t_(d) / 0.004) * np.exp(-t_(d) / 0.16)
    add(mus, x, tb, 0.09)
for e in ev('whip'): add(fx, sfx.whoosh(0.5), e['t'] - 0.05, 0.22); add(fx, hp(sub_hit(0.8, 60, 36), 40) * 0.6, e['t'] + 0.3, 0.14)
CH = {43: [55, 59, 62, 67, 71], 46: [58, 62, 65, 70, 74], 41: [53, 57, 60, 65, 69]}
for i in range(int((T_ARR - 19.1) / S16)):
    tb = 19.1 + i * S16; r = BASS[int(tb // (4 * BEAT)) % 4]; ch = CH.get(r, CH[43])
    p = (tb - 19.1) / (T_ARR - 19.1); m = ch[i % 5] + (12 if p > 0.5 and i % 10 >= 5 else 0)
    add(mus, arp(m, 0.14, 900 + 4500 * p), tb, 0.045 + 0.03 * p, ((i % 5) - 2) * 0.22)
for k, e in enumerate(ev('km')): add(mus, glock(79 + [0, 4, 7][k], 1.4), e['t'], 0.08, [-0.4, 0, 0.4][k])
add(mus, pad([55, 62, 67, 71], 3.0, 1.2, 0.4, 1800), 20.0, 0.10)

# ---------------- Yucheng: impact, the 7 ms bell, AC again ----------------
for e in ev('impact'):
    t0 = e['t']; add(fx, hp(sub_hit(1.8, 90, 32), 40), t0, 0.3); add(fx, hp(noise(0.3), 2000) * np.exp(-t_(0.3) / 0.03), t0, 0.12)
    add(mus, pad([43, 50, 55, 62], 1.6, 0.02, 0.6, 1400), t0, 0.12)
for e in ev('bell'): add(mus, bell(e['n'], 2.2), e['t'], 0.07, 0.25)
d = T_AC - T_ARR; x = tone(43, d, 0.2) * np.minimum(1, t_(d) / 0.05); add(mus, fade(x, 0.01, 0.05), T_ARR, 0.07)
ac_tone(T_AC, 32.4, 43, 100 / 60 * 4, 0.09)
for e in ev('chop'): add(fx, fade(bp(noise(0.2), 500, 4000) * np.exp(-t_(0.2) / 0.04)), e['t'], 0.07)
for e in ev('step'):
    i = e['i']; add(fx, relay(1.1 - 0.17 * i), e['t'], 0.32); add(fx, hp(sub_hit(0.5, 70 - 8 * i, 40 - 4 * i), 40), e['t'], 0.1)

# ---------------- the street: cicadas behind glass, an AC unit; into the hole ----------------
d = 34.1 - 32.4; tt = t_(d)
cic = bp(noise(d), 4200, 7200) * (0.55 + 0.45 * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 38 * tt)))) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * tt) ** 2)
add(amb, fade(lp(cic, 6500), 0.2, 0.2), 32.4, 0.05, 0.4)
unit = (np.sin(2 * np.pi * 75 * tt) + 0.4 * np.sin(2 * np.pi * 150 * tt)) * (1 + 0.1 * np.sin(2 * np.pi * 4 * tt)) + lp(noise(d), 200) * 0.6
add(amb, fade(unit, 0.3, 0.2), 32.4, 0.035, -0.5)
for e in ev('suck'): x = hp(noise(0.6), 1200) * (t_(0.6) / 0.6) ** 3; add(fx, x, e['t'], 0.3)
for e in ev('pop'): add(fx, sfx.pop(), e['t'], 0.28)

# ---------------- the charger: a faint switching whine, AC two octaves up, smoothed at the bridge ----------------
d = PULL0 - 34.6; tt = t_(d); whine = np.sin(2 * np.pi * 7800 * tt) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * tt)); add(amb, fade(whine, 0.3, 0.6), 34.6, 0.004)
ac_tone(35.0, T_DB, 67, 100 / 60 * 4, 0.06)
for e in ev('smooth'):
    if e['n'] == 2: add(fx, fade(bp(noise(0.25), 1500, 9000) * np.exp(-t_(0.25) / 0.05)), e['t'], 0.06)
d = PULL0 + 0.4 - T_DB; x = tone(67, d, 0.12) * np.minimum(1, t_(d) / 0.05); add(mus, fade(x, 0.005, 0.4), T_DB, 0.06)
# the verdict: a low tone (the station) under the high one (the charger); "=" lands a chord
d = PULL0 + 0.4 - 42.2; x = (tone(31, d, 0.1) * 0.4 + tone(43, d, 0.15) * 0.8) * np.minimum(1, t_(d) / 0.8); add(mus, fade(x, 0.05, 0.4), 42.2, 0.10)
for e in ev('equal'):
    t0 = e['t']; add(mus, pad([43, 55, 59, 62, 67, 71, 74], 3.8, 0.04, 2.0, 2600), t0, 0.16)
    add(mus, bell(79, 3.0, 2.0, 1.0), t0, 0.06, -0.3); add(mus, bell(86, 3.0, 2.0, 0.8), t0, 0.05, 0.3)

# ---------------- the pull-out and the end ----------------
for e in ev('pullout'):
    add(fx, sfx.whoosh(1.8) * 0.8, e['t'], 0.14); add(mus, pad([43, 50, 55, 59, 62], DUR - e['t'], 0.8, 2.5, 1700), e['t'], 0.13)
    d = 2.4; tt = t_(d); add(amb, fade(lp(noise(d), 800) * np.sin(np.pi * tt / d), 0.3, 0.3), e['t'] + 0.4, 0.05, -0.6)
    add(amb, fade(bp(noise(d), 4200, 7000) * np.sin(np.pi * tt / d) * 0.6, 0.3, 0.3), e['t'] + 0.6, 0.02, 0.6)
for e in ev('final'): add(fx, hp(sub_hit(2.2, 70, 31), 40), e['t'], 0.26); add(mus, bell(55, 3.5, 3.5, 1.6), e['t'], 0.10); add(mus, bell(67, 3.0, 2.0, 1.0), e['t'], 0.06)
for e in ev('sign'): add(mus, glock(79, 2.0), e['t'], 0.05, 0.2)
d = DUR - PULL0; x = hum(d, 1.0) * np.minimum(1, t_(d) / 1.0); add(amb, fade(x, 0.2, 1.5), PULL0, 0.03)

# ---------------- plotting: tiny scratchy grains while silkscreen draws ----------------
def plotter(d):
    tt = t_(d); gr = (rng.random(len(tt)) > 0.9965).astype(float)
    return bp(lp(gr, 9000) + noise(d) * 0.02, 2500, 7500) * np.minimum(1, tt / 0.02) * np.minimum(1, (d - tt) / 0.04)
for e in ev('plot'): add(fx, plotter(e['d'] + 0.05), e['t'], 0.035 if e.get('big') else 0.02, 0.15)

# ---------------- the voice ----------------
import soxr  # noqa: E402
vo = buf(); vo_env = np.zeros(N)
for e in ev('vo'):
    x, sr = sf.read(os.path.join(HERE, VODIR, e['id'] + '.wav'), dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != SR: x = soxr.resample(x, sr, SR)
    x = hp(x, 80); x = x / (np.sqrt(np.mean(x ** 2)) + 1e-9) * 0.1
    add(vo, x, e['t'], 1.0, 0.0); a0, b0 = int(e['t'] * SR), min(N, int(e['t'] * SR) + len(x)); vo_env[a0:b0] = 1
from scipy.ndimage import uniform_filter1d  # noqa: E402
env = np.clip(uniform_filter1d(vo_env, int(0.3 * SR)) * 1.6, 0, 1)
bed_g = 10 ** (-9.5 * env / 20)                                   # duck the bed so it sits 15–18 dB under the voice
fx_g = 10 ** (-7 * env / 20)

# ---------------- mix ----------------
mix = (mus * 0.9 + amb) * bed_g[:, None] + fx * fx_g[:, None] + vo
for c in range(2): mix[:, c] = lp(hp(mix[:, c], 55) - 0.35 * lp(hp(mix[:, c], 55), 140), 14000)
mix[-int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR))[:, None]
pk = np.abs(mix).max(); mix = mix / pk * 0.5
out = os.path.join(HERE, OUTNAME); sf.write(out, mix.astype(np.float32), SR)
# measure, then set the level to about −16 LUFS with the true peak under −3 dBFS
def measure(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    I = float(r.split('Integrated loudness:')[1].split('I:')[1].split('LUFS')[0]); TP = float(r.split('True peak:')[1].split('Peak:')[1].split('dBFS')[0]); return I, TP
raw = mix.copy()
for _ in range(4):                       # gain into a look-ahead limiter until it reads about −16 LUFS
    I, TP = measure(out)
    raw *= 10 ** ((-16.0 - I) / 20); mix = raw.copy()
    for c in range(2): mix[:, c] = sfx.limit(mix[:, c], 10 ** (-5.0 / 20))
    sf.write(out, mix.astype(np.float32), SR)
I, TP = measure(out)
lo = np.sqrt(np.mean(lp(mix[:, 0], 120) ** 2)) / (np.sqrt(np.mean(mix[:, 0] ** 2)) + 1e-9)
vo_r = np.sqrt(np.mean(vo[vo_env > 0] ** 2)); bed_r = np.sqrt(np.mean((((mus * 0.9 + amb) * bed_g[:, None]))[vo_env > 0] ** 2))
print(f'voice over music under the voice: {20 * np.log10(vo_r / bed_r):.1f} dB')
print(f'{OUTNAME} {len(mix) / SR:.2f}s  integrated {I:.1f} LUFS  true peak {TP:.1f} dBTP  low end (<120 Hz) {20 * np.log10(lo):.1f} dB vs full')
