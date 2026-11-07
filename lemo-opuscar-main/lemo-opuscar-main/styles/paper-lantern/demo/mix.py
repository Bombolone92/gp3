"""The Last Night Train — score + train foley + narration for the whole timeline → out/mix.wav.
python mix.py            whole film
python mix.py 0 10       a cut of the timeline (same mix, sliced, 0.35 s fade-out at the end)
Run with the library's .venv python."""
import sys, os, json
import numpy as np, soundfile as sf, soxr
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('LIB') or os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, LIB)
from core.audio import sampler as S
from core.audio.sfx import SR, add, bp, lp, hp, noise, brown, norm, t_, env_exp, whoosh, thump, limit
from scipy.ndimage import uniform_filter1d, maximum_filter1d

TL = json.load(open(os.path.join(HERE, 'timeline.json')))
H, L, DUR = TL['HIT'], TL['L'], TL['DUR']
N = int(DUR * SR) + SR
tt = np.arange(N) / SR
S.seed(5); rng = np.random.default_rng(4)
def db(x): return 10 ** (x / 20)
def rms(x): return np.sqrt(np.mean(x ** 2) + 1e-12)
def env_lin(pts): xs, ys = zip(*pts); return np.interp(tt, xs, ys)

# ———————— the train's speed (metres of track per second, for the wheel rhythm) and where the clacks fall ————————
B = 60 / 96                       # one beat at 96 bpm; at cruising speed the wheels clack twice per beat (da-dum)
def speed(t):                      # 0..1 of cruising speed
    if t < H['depart']: return 0
    if t < H['stop'] - 1.6: return min(1, ((t - H['depart']) / 4.6) ** 1.4)
    return max(0, (H['stop'] - t) / 1.6)
clacks, ph, t = [], 0., H['depart']
while t < H['stop']:
    v = speed(t)
    if v > .02:
        ph += v * (1 / 240) / (B / 2)
        if ph >= 1: ph -= 1; clacks.append((t, v))
    t += 1 / 240

# ———————————————— score ————————————————
ev = []
def n(t, inst, p, d, v, pan=0., **k): ev.append(dict(t=t, inst=inst, pitch=p, dur=d, vel=v, pan=pan, **k))
# windows light car by car: one glockenspiel note each, rising (and at the terminus, the same notes falling as they go out)
UP = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6']
for k, t in enumerate(H['cars']): n(t, 'glockenspiel', UP[k], 1.6, .32 + .02 * k, .3 - .08 * k)
for k, t in enumerate(H['off']): n(t, 'glockenspiel', UP[::-1][k], 1.8, .3 - .015 * k, -.3 + .08 * k)
n(H['lamp'] + .05, 'vibraphone_bowed', 'A4', 4.0, .22, -.2)
# a quiet string bed under the departure, D major
for p, v, pan in [('D3', .22, -.3), ('A3', .2, .1), ('F#4', .18, .3)]: n(1.4, 'violas' if p != 'D3' else 'cellos', p, 8.6, v, pan, attack=1.6, release=1.2)
# the journey: a harp ostinato locked to the wheels from the departure; a flute tune over it
CH = [('D', ['D3', 'A3', 'D4', 'F#4']), ('A', ['A2', 'E3', 'A3', 'C#4']), ('Bm', ['B2', 'F#3', 'B3', 'D4']), ('G', ['G2', 'D3', 'G3', 'B3'])]
t0 = H['depart'] + .5; bar = 4 * B
def ostinato(a, b, vel=.3):
    k = 0; t = a
    while t < b - .05:
        name, ch = CH[int((t - t0) // bar) % 4]; n(t, 'harp', ch[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]], 1.2, vel * (1.1 if k % 8 == 0 else 1), -.25); t += B / 2; k += 1
ostinato(t0, 22.0)
TUNE = [('F#5', 1.5), ('E5', .5), ('D5', 1), ('A4', 1), ('B4', 1.5), ('A4', .5), ('F#4', 2), ('G4', 1), ('A4', 1), ('B4', 1), ('D5', 1), ('C#5', 1.5), ('B4', .5), ('A4', 2)]
def tune(a, inst='flute', vel=.34, oct=0):
    t = a
    for p, d in TUNE:
        if oct: p = p[:-1] + str(int(p[-1]) + oct)
        n(t, inst, p, d * B * .95, vel, .2, attack=.05); t += d * B
tune(t0 + 2 * bar)                                 # enters on the viaduct
for k in range(int((22 - t0) / bar)):               # piano roots on the bar
    n(t0 + k * bar, 'piano', CH[k % 4][1][0], bar * .9, .26, -.1)
# into the tunnel: minor, rising tremolo, then nothing
for p, v in [('D4', .22), ('F4', .2), ('A4', .2), ('D3', .26)]: n(22.0, 'violins_trem' if p != 'D3' else 'cellos', p, H['portal'] - 22.0 + .1, v, 0, attack=2.0, release=.15)
# out of the tunnel: the river (warm, open), then the sea (broad)
X = H['dark'][1]
for p, v, pan in [('D2', .3, 0), ('D3', .3, -.3), ('A3', .28, -.1), ('F#4', .28, .2), ('A4', .26, .3), ('D5', .24, .25)]:
    n(X, 'contrabass' if p == 'D2' else 'cellos' if p in ('D3', 'A3') else 'violas' if p == 'F#4' else 'violins', p, 4.0, v, pan, attack=.08, release=1.4)
for k, p in enumerate(['D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6']): n(X - .3 + k * .04, 'harp', p, 1.6, .3, .2)
t0 = X + .2; ostinato(X + .2, 40.2, .28); tune(X + .2 + bar, 'flute', .32)
tune(35.4, 'violin', .3)
for p, v in [('D3', .22), ('A3', .2), ('F#4', .2), ('D5', .18)]: n(35.4, 'violas' if p != 'D3' else 'cellos', p, 5.0, v, 0, attack=1.0, release=1.2)
# the terminus: the harp alone, then the falling window notes, a last chord into the end card
for k, p in enumerate(['D3', 'A3', 'D4', 'F#4', 'A4', 'D5']): n(46.0 + k * .07, 'harp', p, 4.5, .3, -.2 + k * .06)
for p, v in [('D3', .2), ('A3', .18), ('F#4', .18)]: n(46.0, 'violas' if p != 'D3' else 'cellos', p, 4.6, v, 0, attack=.8, release=1.6)
n(48.3, 'glockenspiel', 'A5', 2.4, .26, .3)

music = S.render(ev, dur=DUR + 1); music = np.pad(music, ((0, max(0, N - len(music))), (0, 0)))[:N]
music = S.room(music, size=.5, mix=.2)
music = np.pad(music, ((0, max(0, N - len(music))), (0, 0)))[:N]
d0, d1 = H['dark']
music *= np.where((tt > H['portal'] + .1) & (tt < d1), 0, 1)[:, None] * np.clip(1 - (tt - H['portal']) / .2, 0, 1)[:, None] ** (tt < d1)[:, None]

# ———————————————— foley ————————————————
fx = np.zeros((N, 2))
def tick(v=1.):
    d = .03; x = t_(d); return norm(hp(noise(d), 3000) * env_exp(d, .002) + np.sin(2 * np.pi * 2600 * x) * env_exp(d, .004) * .4) * v
def clack(v=1.):
    d = .12; x = t_(d); return norm(lp(noise(d), 1800) * env_exp(d, .012) + np.sin(2 * np.pi * 95 * x) * env_exp(d, .03) * .9 + np.sin(2 * np.pi * 410 * x) * env_exp(d, .01) * .3) * v
def horn(d=1.3):
    x = t_(d); f = [293.7, 370]; s = sum(2 * ((x * fr * (1 + .002 * np.sin(2 * np.pi * 5 * x))) % 1) - 1 for fr in f)
    e = np.minimum(1, x / .08) * np.minimum(1, (d - x) / .35); return norm(lp(bp(s, 200, 2600), 1800) * e)
def hiss(d=1.2, v=1.):
    return norm(bp(noise(d), 2500, 8000) * np.exp(-t_(d) / (d * .4))) * v
def shimmer(d=1.2, f0=1800):
    x = t_(d); s = sum(np.sin(2 * np.pi * f0 * m * (1 + .2 * x / d) * x + m) / m for m in (1, 1.5, 2, 3)) * np.sin(np.pi * x / d) ** 2 * np.exp(-x / d); return norm(s)
# beds: a snowy wind (S1–S3), the river (S4), the sea (S5–S6); everything off in the tunnel
wind = bp(noise(DUR + 1), 250, 1600)[:N] * (.6 + .4 * np.sin(2 * np.pi * tt / 4.3))
add(fx, wind * env_lin([(0, .7), (5, .7), (10, .9), (22, .6), (H['portal'], .4), (H['portal'] + .15, 0), (DUR + 1, 0)]) * db(-31), 0, 1, .2)
river = bp(brown(DUR + 1), 300, 3000)[:N]
add(fx, river * env_lin([(0, 0), (d1, 0), (d1 + .6, .7), (34, .7), (36, 0), (DUR + 1, 0)]) * db(-38), 0, 1, -.2)
sea = bp(brown(DUR + 1), 80, 900)[:N] * (.55 + .45 * np.sin(2 * np.pi * tt / 6.1) ** 2)
add(fx, sea * env_lin([(0, 0), (34.5, 0), (36.5, 1), (DUR + 1, 1)]) * db(-30), 0, 1, 0)
room = lp(brown(DUR + 1), 160)[:N]; add(fx, room * np.where((tt > d0) & (tt < d1), 0, 1) * db(-46), 0, 1, 0)
# the halt: the lamp clicks on, each window a small click; the headlight; the horn; brakes off
add(fx, tick(), H['lamp'], db(-30), -.3); add(fx, shimmer(1.0), H['lamp'] + .05, db(-38), -.3)
for k, t in enumerate(H['cars']): add(fx, tick(.8), t, db(-34), .3 - .08 * k)
add(fx, tick(), H['head'], db(-30), .3)
add(fx, horn(1.3), H['horn'], db(-17), .35)
add(fx, hiss(1.4), H['depart'] - .2, db(-32), .3)
# the wheels: a soft da-dum on the joints, louder with speed; muffled in the tunnel, silent in the dark
for t, v in clacks:
    if d0 <= t < d1: continue
    g = db(-27 + 6 * v) * (.6 if H['portal'] - .3 < t < d0 else 1)
    add(fx, clack(), t, g, .1)
rumble = lp(brown(DUR + 1), 140)[:N] * np.array([speed(x) for x in tt[::480]]).repeat(480)[:N]
add(fx, rumble * np.where((tt > d0) & (tt < d1), 0, 1) * db(-28), 0, 1, 0)
add(fx, whoosh(.9), H['portal'] - .3, db(-24), .2)                       # into the tunnel
add(fx, whoosh(1.2), d1 - .05, db(-24), -.2)                              # out the other side
add(fx, hiss(2.0), H['stop'] - .8, db(-28), .3)                           # brakes at the terminus
for t in H['off']: add(fx, tick(.7), t, db(-34), 0)
add(fx, bp(noise(1.0), 1500, 7000) * np.sin(np.pi * t_(1.0) / 1.0) ** 1.5, H['card'], db(-40), .2)
if os.environ.get('SIGN10') == '1': add(fx, bp(noise(.8), 1500, 7000) * np.sin(np.pi * t_(.8) / .8) ** 1.5, H['sign'], db(-40), .3)

fx *= np.clip(np.minimum(np.abs(tt - d0 - .01), np.abs(tt - d1 + .02)) / .03, 0, 1)[:, None] ** ((tt > d0 - .02) & (tt < d1))[:, None]   # the blink of dark is silent
fx *= np.where((tt > d0 + .02) & (tt < d1 - .02), 0, 1)[:, None]
# ———————————————— voice ————————————————
vo = np.zeros(N)
for i, l in L.items():
    w, sr = sf.read(os.path.join(HERE, 'voices', i + '.wav'), dtype='float32')
    if w.ndim > 1: w = w.mean(1)
    w = soxr.resample(w, sr, SR); s = int(l['at'] * SR); vo[s:s + len(w)] += w[:N - s]
vo = hp(vo, 80)
def comp(x, thr_db=-24, ratio=3.):
    e = np.sqrt(uniform_filter1d(x ** 2, int(.02 * SR)) + 1e-12); ed = 20 * np.log10(e)
    gdb = np.where(ed > thr_db, (thr_db - ed) * (1 - 1 / ratio), 0); gdb = uniform_filter1d(gdb, int(.01 * SR)); return x * db(gdb)
vo = comp(vo); act = np.abs(vo) > 1e-4; vo *= db(-18) / rms(vo[act])
music *= db(-27) / rms(music)
speak = uniform_filter1d(maximum_filter1d(act.astype(float), int(.25 * SR)), int(.25 * SR))
mid = np.stack([bp(music[:, c], 300, 4000) for c in (0, 1)], 1)
music = music * db(-5 * speak)[:, None] - mid * (1 - db(-3)) * speak[:, None]
mix = music + fx + vo[:, None]
mix = np.stack([limit(mix[:, c], .89) for c in (0, 1)], 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
if len(sys.argv) >= 3:
    a, b = float(sys.argv[1]), float(sys.argv[2]); seg = mix[int(a * SR):int(b * SR)].copy()
    f = int(.35 * SR); seg[-f:] *= np.linspace(1, 0, f)[:, None]
    sf.write(os.path.join(HERE, 'out', 'mix.wav'), seg.astype(np.float32), SR); print('cut', a, b)
else:
    sf.write(os.path.join(HERE, 'out', 'mix.wav'), mix[:int(DUR * SR)].astype(np.float32), SR); print('full', DUR)
print('instruments', sorted({e['inst'] for e in ev}), 'clacks', len(clacks))
