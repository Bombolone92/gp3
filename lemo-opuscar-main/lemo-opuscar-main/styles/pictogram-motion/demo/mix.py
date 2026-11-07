"""LEFT BEHIND — score, foley and voice for the whole 50 s timeline, then the span [a, b] → out/mix.wav.
usage: mix.py [a b]      (film seconds; a span shorter than the film gets a 0.3 s audio fade-out at its end)
Reads events.json (film times, exported with a=0&b=50), voice/vo.json (line starts) and out/voice/*.wav (Kokoro).
120 BPM: beat 0.5 s, bar 2 s."""
import os, sys, json
import numpy as np, soundfile as sf, soxr
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('LIB') or os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, LIB)
from core.audio import sampler as S
from core.audio.sfx import SR, t_, env_exp, bp, lp, hp, noise, norm, compress, limit, add, whoosh, thump

FULL = 50.0
A = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
B = float(sys.argv[2]) if len(sys.argv) > 2 else FULL
rng = np.random.default_rng(42)
N = int((FULL + 3) * SR)
mus = np.zeros((N, 2), np.float32)   # music
fx = np.zeros((N, 2), np.float32)    # foley
amb = np.zeros((N, 2), np.float32)   # ambience
EV = json.load(open(f'{HERE}/events.json'))['ev']

# ───────── score ─────────
score = []
def n(t, inst, p, d, v, pan=0.0, g=1.0, **kw): score.append(dict(t=t, inst=inst, pitch=p, dur=d, vel=v, pan=pan, gain=g, **kw))

# §1 rain, D minor (0–4): marimba drips, shaker rain, bowed-vibes pad; bass enters on the match cut (2.5)
drips = ['D5', None, 'A5', 'F5', None, 'C6', 'A5', None, 'D5', 'F5', None, 'A5', 'G5', None, 'F5', 'E5']
for i, p in enumerate(drips):
    if p: n(i * 0.25, 'marimba', p, 0.4, 0.34 + 0.08 * rng.random(), pan=float(rng.uniform(-.5, .5)), g=0.9)
n(0.0, 'vibraphone_bowed', 'D4', 4.0, 0.3, -0.2, 0.55, attack=0.6); n(0.0, 'vibraphone_bowed', 'A4', 4.0, 0.28, 0.2, 0.5, attack=0.6)
n(0.0, 'vibraphone_bowed', 'F4', 4.0, 0.26, 0.0, 0.5, attack=0.8)
for i in range(16):  # shaker 16ths = rain
    n(i * 0.25, 'shaker', 'down' if i % 2 else 'up', None, 0.28 + (0.12 if i % 4 == 0 else 0), pan=0.3, g=0.55)
for t, p, d in [(2.5, 'D2', 0.45), (3.0, 'D2', 0.4), (3.5, 'A1', 0.45)]:
    n(t, 'electric_bass', p, d, 0.7, 0, 1.0)
# §2 sun, F major (4–6.75): the flip opens on a glockenspiel run, marimba brightens
for i, p in enumerate(['F5', 'A5', 'C6', 'F6']): n(4.0 + i * 0.0625, 'glockenspiel', p, 1.2, 0.5, pan=-0.3 + 0.2 * i, g=0.7)
sun = ['F5', 'A5', 'C6', 'A5', 'G5', 'C6', 'A5', 'F5', 'F5', 'C6']
for i, p in enumerate(sun): n(4.5 + i * 0.25, 'marimba', p, 0.35, 0.42, pan=float(rng.uniform(-.4, .4)), g=0.85)
n(4.0, 'vibraphone_bowed', 'F4', 2.6, 0.3, -0.2, 0.55, attack=0.3); n(4.0, 'vibraphone_bowed', 'C5', 2.6, 0.28, 0.2, 0.5, attack=0.3)
n(4.0, 'vibraphone_bowed', 'A4', 2.6, 0.26, 0, 0.5, attack=0.3)
for t, p, d in [(4.0, 'F2', 0.9), (5.0, 'C2', 0.9), (6.0, 'A1', 0.6)]: n(t, 'electric_bass', p, d, 0.72)
# 6.75–7.0: half a beat of nothing (drums and bass out) before the title
# §3 title, F major groove (7.0–): slam, then marimba ostinato
n(7.0, 'crash', None, None, 0.55, 0.0, 0.5)
for p in ['F4', 'A4', 'C5', 'F5']: n(7.0, 'marimba', p, 0.6, 0.75, 0, 0.8)
n(7.0, 'glockenspiel', 'F6', 1.5, 0.5, 0.2, 0.6)
osti = ['F5', 'C6', 'A5', 'C6', 'G5', 'C6', 'A5', 'C6', 'D5', 'A5', 'F5', 'A5', 'E5', 'C6', 'G5', 'C6']
for i in range(14):
    t = 7.5 + i * 0.25
    if t >= 10.75: break
    n(t, 'marimba', osti[(i + 2) % 16], 0.3, 0.36 + (0.08 if i % 2 == 0 else 0), pan=0.35 if i % 2 else -0.35, g=0.8)
for t, p, d in [(7.0, 'F1', 0.9), (8.0, 'F2', 0.4), (8.5, 'A1', 0.4), (9.0, 'D2', 0.9), (10.0, 'C2', 0.9)]:
    n(t, 'electric_bass', p, d, 0.75)
for t, ch in [(7.0, ['F4', 'A4', 'C5']), (9.0, ['D4', 'F4', 'A4']), (10.0, ['C4', 'E4', 'G4'])]:
    for j, p in enumerate(ch): n(t, 'vibraphone_bowed', p, 1.0 if t >= 9 else 2.0, 0.24, -0.2 + 0.2 * j, 0.45, attack=0.15)
for t in np.arange(7.5, 10.6, 1.0): n(float(t), 'claps', None, None, 0.35, 0.1, 0.5)
for t in np.arange(7.25, 10.6, 0.5): n(float(t), 'hihat', 'closed', None, 0.3, 0.25, 0.45)
for t in np.arange(1.0, 4.0, 0.5): n(float(t) + 0.25, 'hihat', 'closed', None, 0.22, 0.25, 0.35)

# §4 ALL DAY (10.5–16.5), F major, the day runs: marimba ostinato, walking bass, a clock ding per card
day = ['F5', 'C6', 'A5', 'C6', 'G5', 'C6', 'A5', 'F5', 'F5', 'A5', 'C6', 'A5', 'Bb5', 'G5', 'E5', 'G5']
for i in range(24):
    t = 10.5 + i * 0.25
    n(t, 'marimba', day[i % 16], 0.3, 0.34 + (0.1 if i % 4 == 0 else 0), pan=0.35 if i % 2 else -0.35, g=0.75)
for i, (p, ch) in enumerate([('F2', ['F4', 'A4', 'C5']), ('C2', ['E4', 'G4', 'C5']), ('Bb1', ['D4', 'F4', 'Bb4'])]):
    t = 10.5 + 2 * i
    n(t, 'electric_bass', p, 0.9, 0.72); n(t + 1.0, 'electric_bass', p, 0.4, 0.6); n(t + 1.5, 'electric_bass', p, 0.4, 0.55)
    for j, q in enumerate(ch): n(t, 'vibraphone_bowed', q, 1.9, 0.22, -0.2 + 0.2 * j, 0.42, attack=0.2)
for t in np.arange(11.0, 16.5, 1.0): n(float(t), 'claps', None, None, 0.32, 0.1, 0.45)
for t in np.arange(10.75, 16.5, 0.5): n(float(t), 'hihat', 'closed', None, 0.28, 0.25, 0.42)
for t, p in [(13.5, 'C6'), (14.5, 'E6'), (15.5, 'G6')]: n(t, 'glockenspiel', p, 1.0, 0.55, 0.2, 0.7)
# dusk (16.5–18.5): the sun goes down a scale, the moon is one high note, then half a beat of nothing
for i, p in enumerate(['C6', 'A5', 'F5', 'D5', 'C5']): n(16.5 + i * 0.125, 'glockenspiel', p, 0.8, 0.42, -0.2, 0.6)
n(16.5, 'electric_bass', 'D2', 1.4, 0.65); n(16.5, 'vibraphone_bowed', 'D4', 1.8, 0.24, -0.2, 0.45, attack=0.3); n(16.5, 'vibraphone_bowed', 'A4', 1.8, 0.22, 0.2, 0.45, attack=0.3)
n(16.5, 'vibraphone_bowed', 'F4', 1.8, 0.22, 0, 0.42, attack=0.3)
n(17.5, 'glockenspiel', 'A6', 1.2, 0.35, 0.3, 0.55)
for t, p in [(17.0, 'D5'), (17.5, 'F5'), (18.0, 'A4')]: n(t, 'marimba', p, 0.4, 0.3, -0.2, 0.7)
# §5 LOST & FOUND (18.5–28), D minor, wood: log drum and claves, low marimba
for p in ['D3', 'A3', 'D4', 'F4']: n(18.5, 'marimba', p, 0.8, 0.7, 0, 0.8)
n(18.5, 'log_drum', 'lo', None, 0.75, 0, 0.8); n(18.5, 'crash', None, None, 0.35, 0, 0.35)
wood = [('lo', 0), ('hi', 0.75), ('hi', 1.0), ('lo', 1.5)]
for bar in range(3):
    for v, o in wood: n(19.0 + bar * 2 + o, 'log_drum', v, None, 0.5, -0.2 if v == 'hi' else 0.1, 0.6)
for t in np.arange(19.25, 24.0, 0.5): n(float(t), 'world_perc', 'claves', None, 0.28, 0.3, 0.35)
for t, p in [(19.0, 'D2'), (20.0, 'A1'), (21.0, 'Bb1'), (22.0, 'A1'), (23.0, 'A1')]: n(t, 'electric_bass', p, 0.9, 0.68)
lowm = ['D4', 'F4', 'A4', 'F4', 'C4', 'E4', 'A4', 'E4']
for i in range(10): n(19.0 + i * 0.25, 'marimba', lowm[i % 8], 0.3, 0.3, pan=0.3 if i % 2 else -0.3, g=0.7)
# the count: a two-octave run that lands on 23.5
run = ['D4', 'E4', 'F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'Bb5', 'C6', 'D6']
for i, p in enumerate(run): n(22.1 + i * (1.85 / 15), 'marimba', p, 0.2, 0.32 + i * 0.02, pan=-0.4 + i * 0.05, g=0.75)
n(24.0, 'crash', None, None, 0.5, 0, 0.45)
for p in ['D3', 'A3', 'D4', 'F4', 'A4']: n(24.0, 'marimba', p, 0.9, 0.75, 0, 0.75)
n(24.0, 'glockenspiel', 'D6', 1.5, 0.5, 0.2, 0.6); n(24.0, 'electric_bass', 'D1', 1.4, 0.8)
for j, q in enumerate(['D4', 'F4', 'A4']): n(24.0, 'vibraphone_bowed', q, 1.9, 0.22, -0.2 + 0.2 * j, 0.42, attack=0.4)
for t, p in [(24.5, 'A4'), (25.0, 'F4'), (25.5, 'D4')]: n(t, 'marimba', p, 0.4, 0.28, 0, 0.65)
# 26–28: one ticking clock and nothing else (the days pass)
# §6 STORM (28–36.5), D minor, driving
for p in ['D3', 'D4', 'F4', 'A4']: n(28.0, 'marimba', p, 0.6, 0.8, 0, 0.75)
n(28.0, 'crash', None, None, 0.6, 0, 0.5)
for t in np.arange(28.0, 34.0, 0.25):
    acc = (round((t - 28.0) / 0.25)) % 4 == 0
    n(float(t), 'frame_drum', 'large' if acc else 'small_muted', None, 0.55 if acc else 0.3, -0.15 if acc else 0.2, 0.7)
for t in np.arange(28.0, 34.0, 0.25): n(float(t), 'shaker', 'down', None, 0.35, 0.3, 0.5)
for i, t in enumerate(np.arange(28.0, 34.0, 0.5)): n(float(t), 'electric_bass', ['D2', 'D2', 'F2', 'D2', 'C2', 'D2', 'A1', 'D2'][i % 8], 0.4, 0.72)
storm_m = ['D5', 'F5', 'E5', 'D5', 'A4', 'C5', 'D5', 'E5']
for i in range(12): n(31.0 + i * 0.25, 'marimba', storm_m[i % 8], 0.3, 0.32, pan=0.3 if i % 2 else -0.3, g=0.7)
# the sign turns (34.5): first F sharp of the film; the shutter rises in six clanks; then silence
n(34.5, 'glockenspiel', 'F#6', 1.4, 0.55, 0.2, 0.65); n(34.5, 'glockenspiel', 'D6', 1.4, 0.45, -0.2, 0.55)
for j, q in enumerate(['D4', 'F#4', 'A4']): n(34.5, 'vibraphone_bowed', q, 1.7, 0.24, -0.2 + 0.2 * j, 0.45, attack=0.3)
for i, t in enumerate([35.0, 35.25, 35.5, 35.75, 36.0, 36.25]): n(t, 'marimba', ['A3', 'D4', 'F#4', 'A4', 'D5', 'F#5'][i], 0.25, 0.5, 0, 0.7)
# §7 BLOOM (36.5–44), D major, everything at once
n(36.5, 'crash', None, None, 0.7, 0, 0.55)
for i, p in enumerate(['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6', 'F#6']): n(36.5 + i * 0.03, 'marimba', p, 0.8, 0.7, -0.5 + i * 0.14, 0.75)
n(36.5, 'glockenspiel', 'A6', 2.0, 0.5, 0.3, 0.6); n(36.5, 'electric_bass', 'D1', 1.8, 0.85)
bloom_m = ['D5', 'A5', 'F#5', 'A5', 'E5', 'A5', 'F#5', 'D6', 'B4', 'F#5', 'D5', 'F#5', 'G4', 'D5', 'B4', 'D5']
for i in range(26):
    t = 37.0 + i * 0.25
    n(t, 'marimba', bloom_m[i % 16], 0.3, 0.38 + (0.1 if i % 4 == 0 else 0), pan=0.35 if i % 2 else -0.35, g=0.8)
for i, (p, ch) in enumerate([('D2', ['D4', 'F#4', 'A4']), ('A1', ['C#4', 'E4', 'A4']), ('B1', ['D4', 'F#4', 'B4']), ('G1', ['D4', 'G4', 'B4'])]):
    t = 36.5 + 2 * i
    if t >= 44: break
    n(t, 'electric_bass', p, 0.9, 0.75); n(t + 1.0, 'electric_bass', p, 0.4, 0.62); n(t + 1.5, 'electric_bass', p, 0.4, 0.6)
    for j, q in enumerate(ch): n(t, 'vibraphone_bowed', q, 1.9, 0.24, -0.2 + 0.2 * j, 0.45, attack=0.15)
for t in np.arange(37.0, 44.0, 1.0): n(float(t), 'claps', None, None, 0.36, 0.1, 0.5)
for t in np.arange(36.75, 44.0, 0.5): n(float(t), 'hihat', 'closed', None, 0.3, 0.25, 0.45)
scale = ['D5', 'E5', 'F#5', 'G5', 'A5', 'B5', 'C#6', 'D6', 'E6', 'F#6', 'G6', 'A6']
for i in range(12): n(41.0 + i * 0.25, 'glockenspiel', scale[i], 0.6, 0.45, 0.4 - i * 0.07, 0.55)
# §8 next morning (44–50): the opening drips again, now in D major, and the last chord
drips2 = ['D5', None, 'A5', 'F#5', None, 'D6', 'A5', None, 'D5', 'F#5', None, 'A5', 'B5', None, 'A5', 'F#5']
for i, p in enumerate(drips2[:10]):
    if p: n(44.0 + i * 0.25, 'marimba', p, 0.4, 0.32, pan=float(rng.uniform(-.5, .5)), g=0.85)
n(44.0, 'electric_bass', 'D2', 1.8, 0.6); n(45.5, 'electric_bass', 'G1', 0.9, 0.6)
for j, q in enumerate(['D4', 'F#4', 'A4']): n(44.0, 'vibraphone_bowed', q, 3.0, 0.24, -0.2 + 0.2 * j, 0.45, attack=0.5)
for p in ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5']: n(46.5, 'marimba', p, 1.5, 0.6, 0, 0.7)
for j, q in enumerate(['D4', 'F#4', 'A4', 'E5']): n(46.5, 'vibraphone_bowed', q, 3.0, 0.26, -0.3 + 0.2 * j, 0.5, attack=0.1)
n(46.5, 'glockenspiel', 'D6', 3.0, 0.5, 0.2, 0.6); n(46.5, 'electric_bass', 'D1', 3.0, 0.75)
n(46.5, 'crash', None, None, 0.35, 0, 0.35)

mus += S.render(score, dur=N / SR, master=False)[:N]

# electronic kick (synthesised)
def kick(v=1.0):
    d = 0.4; tt = t_(d); f = 48 + 90 * np.exp(-tt / 0.03)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, 0.12)
    x += 0.25 * np.tanh(3 * x)  # a little harmonic body so it speaks on small speakers
    return (norm(x) * v).astype(np.float32)
KICKS = [0.5, 2.0, 2.5, 3.5, 4.0, 5.0, 6.0] + [7.0 + 0.5 * i for i in range(8)]
KICKS += [10.5 + 0.5 * i for i in range(12)] + [18.5, 19.0, 20.0, 21.0, 22.0, 23.0, 24.0, 25.0]
KICKS += [28.0 + 0.5 * i for i in range(12)] + [34.0, 34.5] + [36.5 + 0.5 * i for i in range(15)] + [44.0, 45.0, 46.0, 46.5]
KICKS = sorted(set(round(k, 3) for k in KICKS))
BIG = {7.0, 18.5, 24.0, 28.0, 36.5, 46.5}
for t in KICKS: add(mus, kick(0.8 if t in BIG else 0.55), t)
for t in BIG: add(mus, thump(0.55, 46), t)  # low boom under every slam

# ───────── foley (picture-locked to events.json) ─────────
def splash(v):
    d = 0.16; x = bp(noise(d), 1200, 5200) * env_exp(d, 0.03) + 0.4 * lp(noise(d), 400) * env_exp(d, 0.012)
    return norm(x) * v
def tap(v):
    d = 0.08; tt = t_(d); x = hp(noise(d), 900) * env_exp(d, 0.006) + 0.6 * np.sin(2 * np.pi * 180 * tt) * env_exp(d, 0.015)
    return norm(x) * v
def fwump(v):  # umbrella canopy snapping open
    d = 0.32; tt = t_(d)
    x = bp(noise(d), 200, 1800) * np.minimum(1, tt / 0.02) * env_exp(d, 0.06) + 0.7 * np.sin(2 * np.pi * 95 * tt) * env_exp(d, 0.05)
    return norm(x) * v
def clink(v):
    d = 0.5; tt = t_(d)
    x = sum(a * np.sin(2 * np.pi * f * tt) * env_exp(d, tau) for f, a, tau in [(2140, 1, .09), (3460, .6, .06), (5230, .4, .04), (1190, .3, .12)])
    return norm(x + 0.3 * hp(noise(d), 4000) * env_exp(d, .004)) * v
def hiss(d, v, lo=2500, hi=9000, att=0.01):
    tt = t_(d); return norm(bp(noise(d), lo, hi) * np.minimum(1, tt / att) * np.exp(-tt / (d * 0.45))) * v
def flipclicks(v):
    out = np.zeros(int(0.8 * SR))
    for k in range(14):
        s = int((0.5 * k / 14) * SR); d = 0.03; tt = t_(d)
        c = hp(noise(d), 2000) * env_exp(d, 0.003) + 0.5 * np.sin(2 * np.pi * (1500 + 90 * k) * tt) * env_exp(d, 0.006)
        out[s:s + len(c)] += c * (0.6 + 0.4 * rng.random())
    return norm(out) * v
def plink(v):
    d = 0.4; tt = t_(d); f = 1500 + 900 * (1 - np.exp(-tt / 0.02))
    return norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, 0.07)) * v
def busbell(v):
    d = 1.2; tt = t_(d)
    x = sum(a * np.sin(2 * np.pi * f * tt) * env_exp(d, tau) for f, a, tau in [(1760, 1, .4), (3520, .35, .2), (2637, .3, .3), (5280, .12, .08)])
    return norm(x) * v

def thunder(v, d=2.6):
    tt = t_(d)
    crack = hp(noise(d), 1500) * np.exp(-tt / 0.05)
    roll = lp(noise(d), 260) * np.minimum(1, tt / 0.08) * np.exp(-tt / 0.9) * (1 + 0.4 * np.sin(2 * np.pi * 3.3 * tt))
    return norm(crack * 0.7 + roll * 1.4) * v
def clank(v, f=180):
    d = 0.35; tt = t_(d)
    x = sum(a * np.sin(2 * np.pi * f * m * tt) * env_exp(d, tau) for m, a, tau in [(1, 1, .12), (2.76, .5, .07), (5.4, .3, .04)])
    return norm(x + 0.5 * bp(noise(d), 800, 4000) * env_exp(d, .01)) * v
def tick(v):
    d = 0.05; tt = t_(d); return norm(np.sin(2 * np.pi * 2600 * tt) * env_exp(d, 0.005) + 0.4 * hp(noise(d), 3000) * env_exp(d, 0.002)) * v

for e in EV:
    t, k = e['t'], e['type']
    if k == 'pop': add(fx, fwump(0.7), t)
    elif k == 'step_wet': add(fx, splash(0.32), t, pan=0.1)
    elif k == 'furl': add(fx, whoosh(0.4, 0.3), t - 0.05)
    elif k == 'clink': add(fx, clink(0.32), t, pan=-0.2)
    elif k == 'brake': add(fx, hiss(0.5, 0.16, 3000, 9000, 0.05), t + 0.1, pan=0.3)
    elif k == 'ding':
        add(fx, busbell(0.36), t, pan=0.2); add(fx, busbell(0.3), t + 0.25, pan=0.2)
    elif k == 'flip': add(fx, flipclicks(0.4), t - 0.1); add(fx, whoosh(0.5, 0.25), t - 0.12)
    elif k == 'door_open': add(fx, hiss(0.45, 0.32, 1800, 8000), t, pan=0.35); add(fx, thump(0.25, 120), t + 0.22, pan=0.35)
    elif k == 'step_dry': add(fx, tap(0.3), t, pan=0.45)
    elif k == 'door_close': add(fx, hiss(0.3, 0.22, 1800, 8000), t, pan=0.35); add(fx, thump(0.35, 110), t + 0.28, pan=0.35)
    elif k == 'iris': add(fx, whoosh(0.4, 0.3), t - 0.12)
    elif k == 'drip': add(fx, plink(0.3), t + 0.24, pan=-0.15)
    elif k in ('rows', 'quarter', 'slide', 'split', 'flipT'): add(fx, whoosh(0.35, 0.22), t - 0.12)
    elif k == 'whip': add(fx, whoosh(0.3, 0.28), t - 0.14, pan=0.3)
    elif k == 'card': add(fx, flipclicks(0.22), t - 0.08)
    elif k == 'moon': add(fx, plink(0.12), t, pan=0.3)
    elif k == 'descend': add(fx, whoosh(0.45, 0.3), t)
    elif k == 'slam': add(fx, clank(0.25, 140), t)
    elif k == 'tag': add(fx, clink(0.25), t, pan=-0.4)
    elif k == 'count': add(fx, fwump(0.3), t)
    elif k == 'tick': add(fx, tick(0.45), t, pan=0.15)
    elif k == 'thunder': add(fx, thunder(0.95), t)
    elif k == 'thunder2': add(fx, thunder(0.6, 2.0), t, pan=-0.3)
    elif k == 'signflip': add(fx, whoosh(0.25, 0.25), t - 0.05); add(fx, clink(0.3), t + 0.15)
    elif k == 'shutter': add(fx, clank(0.28, 150 + 30 * ((t - 35.0) / 0.25)), t, pan=float(rng.uniform(-.3, .3)))
    elif k == 'bloom':
        for q in range(14): add(fx, fwump(0.35), t + q * 0.016, pan=float(rng.uniform(-.8, .8)))
    elif k == 'rowshift': add(fx, whoosh(0.3, 0.22), t - 0.06, pan=-0.3 if (t * 2) % 2 else 0.3)
    elif k == 'stop': add(fx, fwump(0.18), t, pan=0.6 - e.get('i', 0) * 0.1)
    elif k == 'step_soft': add(fx, tap(0.22), t, pan=0.1)
    elif k == 'end': add(fx, whoosh(0.35, 0.2), t - 0.12)

# rain bed: bright outside (0–2.5), muffled inside the bus while the camera is close (2.5–3.2), outside again until the sun
def rainbed(d):
    x = bp(noise(d), 900, 7000) * 0.5 + lp(noise(d), 600) * 0.15
    ticks = np.zeros(len(x)); idx = rng.integers(0, len(ticks), int(d * 60)); ticks[idx] = rng.uniform(.3, 1, len(idx))
    return x + hp(np.convolve(ticks, np.exp(-np.arange(200) / 30), 'same'), 2000) * 0.6
rb = rainbed(4.6)
tt = t_(4.6)
inside = np.clip((tt - 2.45) / 0.1, 0, 1) * (1 - np.clip((tt - 3.0) / 0.5, 0, 1))
bed = rb * (1 - inside) * 0.9 + lp(rb, 900, 2) * inside * 1.4
bed *= np.minimum(1, tt / 0.15) * (1 - np.clip((tt - 4.0) / 0.35, 0, 1))
add(amb, norm(bed) * 0.07, 0.0, pan=-0.2); add(amb, norm(rainbed(4.6) * (1 - inside * 0.6)) * 0.05 * np.minimum(1, tt / .15) * (1 - np.clip((tt - 4.0) / .35, 0, 1)), 0.0, pan=0.5)
# daylight street air after the flip
d = 7.0; air = lp(noise(d), 500) * 0.6 + bp(noise(d), 1500, 4000) * 0.08
add(amb, norm(air) * 0.035 * np.minimum(1, t_(d) / 0.6), 4.0)

def rain_span(t0, t1, level, lo=900):
    d = t1 - t0; x = rainbed(d); tt = t_(d)
    if lo != 900: x = hp(x, lo)
    env = np.minimum(1, tt / 0.3) * np.minimum(1, (d - tt) / 0.4)
    add(amb, norm(x) * level * env, t0, pan=-0.2); add(amb, norm(rainbed(d)) * level * 0.7 * env, t0, pan=0.5)
rain_span(27.95, 36.4, 0.11)       # the storm (it starts on the thunder, after the ticking)
rain_span(36.5, 44.0, 0.07)        # rain on 313 canopies
rain_span(44.0, 49.9, 0.06)        # the next morning

music = mus + fx + amb
# ───────── voice ─────────
vo = json.load(open(f'{HERE}/voice/vo.json'))
voice = np.zeros((N, 2), np.float32)
env = np.zeros(N, np.float32)
for v in vo:
    p = f"{HERE}/out/voice/{v['id']}.wav"
    if not os.path.exists(p): continue
    x, sr = sf.read(p, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    x = soxr.resample(x, sr, SR)
    x = hp(x, 90)
    x = compress(norm(x, 0.9), thr=0.22, ratio=3.0, att=0.005, rel=0.1)
    s = int(v['t'] * SR); e = min(N, s + len(x))
    lo, hi = max(0, s - int(0.6 * SR)), min(N, e + int(0.3 * SR))
    mr = np.sqrt(np.mean(music[s:e] ** 2)) + 1e-6
    vr = np.sqrt(np.mean(x[x != 0] ** 2)) + 1e-6
    g = (mr * 10 ** (10 / 20)) / vr
    g = float(np.clip(g, 0.2, 4.0))
    add(voice, x, v["t"], gain=g * 0.75)
    env[s:e] = 1
# ducking + 300 Hz–4 kHz dip in the music under the voice
from scipy.ndimage import uniform_filter1d
env = uniform_filter1d(uniform_filter1d(env, int(0.08 * SR)), int(0.08 * SR))
band = np.stack([bp(music[:, 0], 300, 4000), bp(music[:, 1], 300, 4000)], 1)
music = music * (1 - 0.3 * env[:, None]) - band * (0.45 * env[:, None])
mix = music + voice
mix = np.stack([limit(mix[:, 0], 0.95), limit(mix[:, 1], 0.95)], 1)

seg = mix[int(A * SR):int(B * SR)].copy()
f = int((0.3 if B < FULL else 0.8) * SR); seg[-f:] *= np.linspace(1, 0, f)[:, None]
os.makedirs(f'{HERE}/out', exist_ok=True)
sf.write(f'{HERE}/out/mix.wav', seg.astype(np.float32), SR, subtype='FLOAT')
# report: voice vs music level, cue list
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
for v in vo:
    s, e = int(v['t'] * SR), int((v['t'] + 2) * SR)
    if v['t'] < B and v['t'] >= A: print(f"{v['id']}: voice {rms_db(voice[s:e]):.1f} dB, music {rms_db(music[s:e]):.1f} dB")
print('cues:', ' '.join(f"{e['type']}@{e['t']}" for e in EV if A <= e['t'] < B))
print('wrote out/mix.wav', round(len(seg) / SR, 3), 's')
