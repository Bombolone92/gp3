"""Score + sound for 《6 公里》 -> mix.wav (48 kHz stereo, exactly DUR seconds).
Run from the library root:
    node core/render/events.mjs styles/transit-map/demo        (writes events.json from the picture)
    .venv/bin/python styles/transit-map/demo/audio.py
(sh styles/transit-map/demo/build.sh runs the whole chain.)
120 BPM (beat 0.5 s), D major. The station chime (A5 -> F#5, 'ding-dong') is the motif: the cut into the map,
the 2010 landing, the verdict, 'you are here', the end card. Each new line adds an instrument to the groove."""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); LIB = os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, LIB)
import numpy as np, soundfile as sf
from core.audio import sampler as S
from core.audio.sfx import SR, add, limit, whoosh, click, clack, pop, thump, ding, noise, bp, hp, lp, t_, env_exp, norm, brown, compress, crash

S.seed(23)
rng = np.random.default_rng(5)
EV = json.load(open(os.path.join(HERE, 'events.json')))
DUR = EV['dur']; ev = EV['ev']; N = int(round(DUR * SR))
# the score is written in story time (tau, as in timeline.js) and placed in film time through the same WARP
WARP = [[0, 0], [6.2, 6.2], [9.0, 7.3], [29.7, 28.0], [30.5, 28.0], [47.0, 44.5]]
def T(u):
    for (ta, ua), (tb, ub) in zip(WARP, WARP[1:]):
        if ub > ua and ua <= u < ub: return ta + (tb - ta) * (u - ua) / (ub - ua)
    return WARP[-1][0] if u >= WARP[-1][1] else u
_add = add
def add(buf, x, at, gain=1.0, pan=0.0, raw=False): _add(buf, x, at if raw else T(at), gain, pan)
cue = {e['type']: e['tau'] for e in ev if e['type'] not in ('stop', 'x', 'minor', 'depart', 'year')}
used = set(); mus = []
def n(t, inst, pitch, dur, vel, pan=0, gain=1.0, raw=False, **kw):
    if not raw: t = T(t)
    if t < 0 or t >= DUR: return
    used.add(inst); mus.append(dict(t=float(t), inst=inst, pitch=pitch, dur=dur, vel=vel, pan=pan, gain=gain, **kw))
M = S.midi
CH = {'D': ['D3', 'A3', 'D4', 'F#4'], 'Bm': ['B2', 'F#3', 'B3', 'D4'], 'G': ['G2', 'D3', 'G3', 'B3'], 'A': ['A2', 'E3', 'A3', 'C#4'], 'Em': ['E3', 'B3', 'E4', 'G4']}
ROOT = {'D': 'D2', 'Bm': 'B1', 'G': 'G1', 'A': 'A1', 'Em': 'E2'}
PROG = ['D', 'Bm', 'G', 'A']          # one chord per bar (2 s)
def chord_at(t, t0): return PROG[int((t - t0) // 2.0) % 4]
def chime(t, v=.7, pan=0, g=.7):     # the station chime motif
    n(t, 'vibraphone_hard', 'A5', 1.4, v, pan, g); n(t + .32, 'vibraphone_hard', 'F#5', 2.2, v * .92, pan, g)
    n(t, 'glockenspiel', 'A6', .8, v * .55, pan, g * .5); n(t + .32, 'glockenspiel', 'F#6', 1.2, v * .5, pan, g * .5)

# ---------------------------------------------------------------- 1.4–6.2  the first section
chime(cue['chime'], .72)
n(2.0, 'violins', 'F#5', 4.2, .32, -.3, .45, attack=1.2, release=1.0); n(2.0, 'cellos', 'D3', 4.2, .34, .3, .45, attack=1.2, release=1.0)
n(2.0, 'violas', 'A4', 4.2, .28, 0, .35, attack=1.4, release=1.0)
for k, p in enumerate(['D5', 'F#5', 'A5', 'D6']): n(cue['plaque'] + k * .07, 'harp', p, 2.0, .5, -.3 + k * .2, .5)
first = [e for e in ev if e['type'] == 'stop' and e['tau'] < 6]
for k, e in enumerate(sorted(first, key=lambda e: e['tau'])):
    n(e['tau'], 'glockenspiel', ['D6', 'E6', 'F#6', 'A6', 'B6'][min(k, 4)], .9, .55, e['pan'], .55)
    n(e['tau'], 'marimba', ['D5', 'E5', 'F#5', 'A5', 'B5'][min(k, 4)], .5, .5, e['pan'], .45)

# ---------------------------------------------------------------- 6.2–20  groove in D (bar = 2 s from 6.3)
G0 = 6.3
def groove(a, b, dense=1.0, kick=True, gain=1.0):   # runs in film time so the tempo never stretches
    a, b = T(a), T(b); t = a; i = 0
    while t < b - 1e-6:
        ch = chord_at(t, T(G0)); tones = CH[ch]
        p = M(tones[[0, 2, 1, 3, 2, 1, 3, 2][i % 8]]) + 12
        n(t, 'marimba', p, .3, (.45 + .1 * (i % 2 == 0)) * dense, -.25 + .5 * (i % 2), .5 * gain, raw=True)
        if i % 2 == 0: n(t, 'contrabass_pizz', ROOT[ch], .45, .7 if i % 4 == 0 else .52, 0, .85 * gain, raw=True)
        if kick and i % 4 == 0: n(t, 'bass_drum', None, None, .42, 0, .5 * gain, raw=True)
        t += .25; i += 1
groove(G0, 8.36)
groove(8.78, 20.0, gain=1.0)
# the ring falls (8.36) and lands on People's Square (8.78)
drop = cue['drop'] if 'drop' in cue else 8.78
n(drop, 'bass_drum', None, None, 1.0, 0, 1.0); n(drop, 'timpani', 'D3', 2.0, .95, 0, .9); n(drop, 'gran_cassa', None, None, .7, 0, .6)
for p, pan in (('D3', -.2), ('A3', .2), ('F#4', 0)): n(drop, 'horn', p, 1.4, .72, pan, .5, release=.6)
n(drop, 'trombone', 'D2', 1.0, .7, 0, .42, release=.5); n(drop, 'sus_cymbal', None, None, .45, .2, .35)
# under the river: the ensemble is filtered (done below); a bowed pad holds
n(9.15, 'vibraphone_bowed', 'F#4', 1.4, .45, 0, .45, attack=.3, release=.6)
# line 3 arrives: clarinet answers
for k, p in enumerate(['A4', 'B4', 'D5', 'E5', 'F#5', 'A5']): n(11.45 + k * .19, 'clarinet_stac', p, .2, .55, .3, .5)
# 2001–2010: each new line adds a voice (enters at the line's first departure)
LAYERS = {'M': ('glass', 0), '5': ('flute_stac', 12), '4': ('violins_spic', 12), '6': ('xylophone', 12), '8': ('horn_stac', 0),
          '9': ('harp', 12), '7': ('trumpet_stac', 0), '11': ('cellos_spic', 0), '10': ('vibraphone', 12), '13': ('oboe_stac', 12)}
first_dep = {}
for e in ev:
    if e['type'] == 'depart' and e['line'] not in first_dep: first_dep[e['line']] = e
burst = [(first_dep[k]['tau'], k) for k in LAYERS if k in first_dep and 12.5 < first_dep[k]['tau'] < 19]
G0f = T(G0)
for j, (t0, k) in enumerate(sorted(burst)):
    inst, oc = LAYERS[k]; pan = [-.6, .6, -.35, .35, -.8, .8, -.15, .15, -.5, .5][j % 10]
    pat = [[0, 2, 3], [1, 3, 2, 0], [2, 1, 0, 3], [3, 2], [0, 3, 1]][j % 5]
    t = (np.ceil((T(t0) - G0f) / .25) * .25) + G0f; i = 0     # on the groove's grid, in film time
    while t < T(20.0):
        if (i + j) % [2, 4, 3, 2, 4][j % 5] == 0:
            ch = chord_at(t, G0f); p = M(CH[ch][pat[i % len(pat)]]) + oc
            v = .42 + .06 * (i % 2 == 0)
            if inst in ('glass', 'vibraphone', 'harp'): n(t, inst, p + 12 if inst == 'glass' else p, .8, v, pan, .42, raw=True)
            else: n(t, inst, p, .22, v, pan, .38, raw=True)
        t += .25; i += 1
    n(t0, 'glockenspiel', 'A6', .6, .45, pan, .35)
# snare backbeat from 2007, roll into the landing
for t in np.arange(16.8, 18.2, 1.0): n(float(t), 'snare2', 'stick', None, .45, .1, .35)
n(17.62, 'snare', 'roll', 1.0, .55, 0, .45)
L10 = cue['landing']
n(L10, 'bass_drum', None, None, .95, 0, .9); n(L10, 'timpani', 'D3', 2.5, .85, 0, .8); n(L10, 'crash', None, None, .5, .2, .4)
for p, pan in (('D3', -.25), ('A3', .25), ('F#4', 0), ('D4', -.1)): n(L10, 'horn', p, 1.3, .62, pan, .45, release=.8)
n(L10, 'violins', 'A5', 1.4, .5, -.3, .5, release=.8); n(L10, 'cellos', 'D2', 1.4, .55, .3, .55, release=.8)
chime(L10 + .05, .62, .3, .55)

# ---------------------------------------------------------------- 20–28  one time axis
V = cue['verdict']
for t in np.arange(21.0, 25.5, .5): n(float(t), 'woodblock', None, None, .42 + .12 * ((t - 21.0) % 1 == 0), -.2, .5)
n(21.0, 'cellos', 'D3', 1.4, .55, -.2, .7, attack=.3); n(22.4, 'cellos', 'A3', 3.2, .4, -.2, .45, attack=.2, release=.8)
n(21.0, 'contrabass', 'D2', 4.5, .38, 0, .45, attack=.4, release=.6)
for y in range(1880, 2027, 20):                 # a tick as the London line passes each 20 years
    t = 21.0 + (y - 1863) / 163 * 1.4; n(t, 'violins_pizz', 'D5' if y % 40 else 'A5', .3, .45, -.4 + .8 * (y - 1863) / 163, .35)
for k, p in enumerate(['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6', 'D7']):   # Shanghai: a fast run
    n(22.55 + k * .055, 'glockenspiel', p, .6, .5 + .03 * k, .4, .45)
n(23.3, 'violins', 'E5', 2.2, .4, -.3, .55, attack=.5, release=.3); n(23.3, 'violas', 'A4', 2.2, .38, .3, .5, attack=.5, release=.3); n(23.3, 'cellos', 'D3', 2.2, .4, 0, .5, attack=.5, release=.3)
for t in np.arange(23.3, 25.45, .25): n(float(t), 'hihat', None, None, .3, .3, .25)
# 25.5–26.0: the music stops for a beat; the verdict rings
n(V, 'tubular_bells', 'D5', 3.0, .7, 0, .6); chime(V + .05, .6, 0, .5)
n(V + .65, 'bass_drum', None, None, .7, 0, .6); n(V + .65, 'timpani', 'D3', 1.6, .6, 0, .55)
for p, pan in (('D3', -.25), ('A3', .25), ('F#4', 0)): n(V + .65, 'horn', p, 1.3, .5, pan, .42, release=.8)

# ---------------------------------------------------------------- 28–36  now: everything runs
n(28.0, 'snare', 'roll', 1.85, .5, 0, .42); n(28.0, 'violins', 'D5', 1.9, .35, -.3, .4, attack=1.2)
n(28.0, 'cellos', 'A2', 1.9, .4, .3, .45, attack=1.0)
G1 = 29.9
def groove2(a, b):
    a, b = T(a), T(b); t = a; i = 0
    while t < b - 1e-6:
        ch = chord_at(t, T(G1)); tones = CH[ch]
        n(t, 'marimba', M(tones[[0, 2, 1, 3, 2, 1, 3, 2][i % 8]]) + 12, .3, .5 + .1 * (i % 2 == 0), -.25 + .5 * (i % 2), .5, raw=True)
        if i % 2 == 0: n(t, 'contrabass_pizz', ROOT[ch], .45, .75 if i % 4 == 0 else .55, 0, .85, raw=True)
        if i % 4 == 0: n(t, 'bass_drum', None, None, .5, 0, .55, raw=True)
        if i % 4 == 2: n(t, 'snare2', 'stick', None, .45, .12, .3, raw=True)
        if i % 8 == 0:
            n(t, 'violins', M(tones[3]) + 12, 1.9, .42, -.35, .4, attack=.15, raw=True); n(t, 'cellos', ROOT[ch], 1.9, .45, .35, .45, attack=.1, raw=True)
            n(t, 'horn', M(tones[1]), 1.8, .4, .2, .3, attack=.1, raw=True)
            for k in range(3): n(t + k * .5 + .25, 'violins_spic', M(tones[k + 1]) + 12, .15, .45, -.2, .3, raw=True)
        if i % 2 == 1: n(t, 'xylophone', M(tones[(i // 2) % 4]) + 24, .2, .35, .5, .25, raw=True)
        t += .25; i += 1
groove2(G1, 34.6)
for k, p in enumerate(['D5', 'F#5', 'A5', 'D6']): n(G1 + k * .06, 'harp', p, 1.6, .55, -.3 + k * .2, .45)
n(G1, 'crash', None, None, .45, -.2, .35); n(G1, 'timpani', 'D3', 1.5, .7, 0, .6)
RL = cue['rideland']; chime(RL, .6, -.2, .5)
# 34.6–36: the ensemble lifts away
n(34.6, 'violins', 'F#5', 2.2, .4, -.3, .42, attack=.1, release=1.0); n(34.6, 'cellos', 'D3', 2.2, .42, .3, .45, release=1.0)
n(34.6, 'horn', 'A3', 2.0, .38, 0, .32, release=1.0)

# ---------------------------------------------------------------- 36–45.5  back to the start, end card
n(36.0, 'vibraphone_bowed', 'D5', 6.0, .35, 0, .38, attack=1.0, release=1.5); n(36.0, 'cellos', 'D3', 6.2, .3, .2, .3, attack=1.5, release=1.5)
chime(cue['here'], .7, -.2, .65)
for k, p in enumerate(['A4', 'D5', 'F#5', 'A5']): n(cue['caption'] + k * .09, 'harp', p, 2.5, .45, .2, .4)
E = cue['end']
n(E, 'harp', 'D4', 3.0, .5, -.2, .45); n(E + .08, 'harp', 'A4', 3.0, .48, 0, .42); n(E + .16, 'harp', 'D5', 3.0, .46, .2, .42)
for p, pan in (('D3', -.25), ('A3', .25), ('F#4', 0)): n(E + .5, 'horn', p, 2.4, .42, pan, .35, attack=.2, release=1.2)
n(E + .5, 'violins', 'A5', 2.4, .32, -.3, .35, attack=.3, release=1.2); n(E + .5, 'contrabass', 'D2', 2.4, .35, 0, .35, attack=.3, release=1.2)
chime(cue['endring'] + .02, .5, .1, .45)

music = S.render(mus, dur=DUR + 3, master=False)[:N]
# under the river: low-pass the music between 9.15 and 10.32 (block-wise, smooth cutoff)
def sweep_lp(x, a, b, lo=520):
    out = x.copy(); i0, i1 = int((a - .25) * SR), int((b + .25) * SR); blk = 1200
    for i in range(i0, i1, blk):
        tt = i / SR; d = min(1, max(0, (tt - (a - .25)) / .35)) * min(1, max(0, ((b + .25) - tt) / .35))
        fc = np.exp(np.log(12000) * (1 - d) + np.log(lo) * d)
        seg_ = x[max(0, i - 4000):i + blk]
        y = np.stack([lp(seg_[:, c], fc, 2) for c in range(2)], 1)[-(min(blk, len(x) - i)):]
        out[i:i + len(y)] = y
    return out
music = sweep_lp(music, T(cue['dive']), T(cue['surface']))
# the beat of silence before the verdict
g = np.ones(N, np.float32); a, b = int(T(25.45) * SR), int(T(V) * SR); g[a:b] = np.linspace(1, .04, b - a) ** 2
g[:int(1.4 * SR)] = 0
music *= g[:, None]
music = S.room(music, size=.4, mix=.15)

# ---------------------------------------------------------------- sound effects
fx = np.zeros((N, 2), np.float32)
def riser(d, f0=400, f1=6000):
    x = noise(d); out = np.zeros_like(x)
    for i in range(0, len(x), 480):
        hi = min(len(x), i + 480); f = f0 + (f1 - f0) * (i / len(x)) ** 2
        out[i:hi] = bp(x[max(0, i - 2000):hi], f * .8, f * 1.25)[-(hi - i):]
    return norm(out * (t_(d) / d) ** 2)
def pen(d):
    x = lp(hp(noise(d), 1100), 3800) * (1 + .25 * np.sin(2 * np.pi * 7 * t_(d)))
    e = np.minimum(1, t_(d) / .12) * np.minimum(1, (d - t_(d)) / .15); return norm(x * e)
def falling(d):           # the ring falling: a descending whistle + air
    tt = t_(d); f = 1800 * np.exp(-tt * 3.2) + 180; ph = 2 * np.pi * np.cumsum(f) / SR
    return norm(np.sin(ph) * .25 * (tt / d) + lp(noise(d), 900) * (tt / d) ** 2)
# tunnel: rumble rising, wheel clacks accelerating, the train's horn, the flare riser
d0 = 1.42
rum = hp(lp(brown(d0), 160), 45, 2); rum = norm(rum) * np.linspace(.35, 1, len(rum)) ** 2
add(fx, rum, 0, .55); add(fx, -rum[::-1] * .0, 0, 0)
tt = 0.05
while tt < 1.3:
    for dt in (0, .055): add(fx, clack(.8 + .3 * tt, .8), tt + dt, .12 + .2 * tt, -.3 + .6 * (tt / 1.3))
    tt += max(.09, .28 - .16 * tt)
horn = np.zeros(int(.7 * SR)); th = t_(.7)
for f in (311, 415): horn += np.sign(np.sin(2 * np.pi * f * th)) * .5
horn = lp(horn, 2400) * np.minimum(1, th / .05) * np.minimum(1, (.7 - th) / .2)
add(fx, norm(horn), .55, .16, 0)
add(fx, riser(.45, 300, 7000), 0.98, .3, 0)
# events from the picture
last_click = -1
for e in ev:
    t, ty, pan = e['tau'], e['type'], e.get('pan', 0)
    if ty == 'depart' and e.get('t1', t) > t:
        dd = e['t1'] - e['t'] + .1
        if dd > .15: add(fx, pen(dd), t, .05 if t > 12.5 else .07, pan)
        if 12.5 < t < 19 or 28 < t < 30: add(fx, whoosh(.22), t - .03, .05, pan)
    elif ty == 'stop' and e.get('vis') and t > 1.5:
        if t - last_click > .045: add(fx, click(1.1 + .4 * ((sum(map(ord, e['id'])) % 7) / 7), 1), t, .1 if t < 12.6 else .05, pan); last_click = t
    elif ty == 'x' and e.get('vis'):
        add(fx, pop(1), t, .08, pan); add(fx, thump(1, 95), t, .12, pan)
    elif ty == 'drop':
        add(fx, thump(1, 58), t, .6, 0); add(fx, pop(1), t, .25, 0); add(fx, crash(.6), t, .12, .1)
add(fx, falling(.42), cue['fall'], .3, .1)
add(fx, whoosh(.5), cue['dive'] - .1, .22, -.2)
wat = lp(noise(1.2), 380) * np.sin(np.linspace(0, np.pi, int(1.2 * SR))); add(fx, norm(wat), cue['dive'] + .05, .1, 0)
add(fx, pop(1), cue['surface'], .18, .3)
add(fx, click(.7, 1), cue['plaque'], .14, .3)
for k, t in enumerate(np.arange(4.3, 12.6, .55)): add(fx, clack(1.3, .5), float(t), .05, -.2 + .4 * (k % 2))   # the shuttle
for t in (6.3, 7.62, 11.45):   # the year drums roll
    for k in range(6): add(fx, click(2.2, .6), t + k * .04, .05, -.7)
add(fx, whoosh(1.1), cue['glide'] - .05, .28, 0)
add(fx, whoosh(.8), cue['shanghai'] - .05, .12, .4)
add(fx, thump(1, 60), V + .65, .35, 0); add(fx, clack(.7, 1), V + .65, .2, .1)
add(fx, whoosh(1.4), cue['rise'] - .05, .32, 0)
for k in range(30): add(fx, click(2.2, .5), 28.05 + k * .06, .04, -.7)
# the sign passing close to the lens: a doppler-ish swish
sw = whoosh(1.6); add(fx, sw, cue['sign'] + .3, .3, .5); add(fx, sw * .6, cue['sign'] + .5, .2, -.5)
for k in range(24): add(fx, click(2.4, .5), 31.4 + k * .06, .035, -.7)
# trains everywhere: ta-tak pairs in eighths across the stereo field
for k, t in enumerate(np.arange(29.6, 36.2, .25)):
    v = .05 * min(1, (t - 29.6) / .6) * min(1, (36.2 - t) / 1.0)
    add(fx, clack(1.0 + .1 * (k % 3), .7), float(t), v, [-.7, .5, -.2, .8, -.5, .2][k % 6])
add(fx, whoosh(1.2), cue['lift'], .2, 0); add(fx, whoosh(1.0), cue['push'], .15, 0)
add(fx, pen(.6), E, .06, -.2); add(fx, pop(1), cue['endring'], .14, 0)

# ---------------------------------------------------------------- mix
mix = music * .9 + fx
mix = np.stack([hp(mix[:, c], 38, 4) for c in range(2)], 1)
mix = mix - .45 * np.stack([lp(mix[:, c], 75, 2) for c in range(2)], 1)   # about -5 dB shelf under 75 Hz
fade = np.ones(N, np.float32); f0 = N - int(.7 * SR); fade[f0:] = np.linspace(1, 0, N - f0) ** 1.5; mix *= fade[:, None]
mix = np.stack([limit(mix[:, 0], .9), limit(mix[:, 1], .9)], 1)
# loudness to about -16 LUFS (measured with ffmpeg ebur128), true-peak ceiling -3.2 dBTP (4x oversampled)
import soxr, subprocess, tempfile, re
def lufs_tp(x):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: tmp = f.name
    sf.write(tmp, x.astype(np.float32), SR, subtype='FLOAT')
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', tmp, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    os.remove(tmp)
    I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1]); P = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', out)[-1]); return I, P
mix = np.stack([compress(mix[:, c], thr=.16, ratio=2.8, att=.008, rel=.18) for c in range(2)], 1)
ceil = 10 ** (-3.4 / 20)
for _ in range(9):
    I, P = lufs_tp(mix); mix *= 10 ** ((-16.0 - I) / 20)
    for c in range(2): mix[:, c] = limit(mix[:, c], ceil * .78)
    up = soxr.resample(mix, SR, SR * 4); tp = np.abs(up).max()
    if tp > ceil: mix *= ceil / tp
I, P = lufs_tp(mix); tp = 10 ** (P / 20)
print('measured', I, 'LUFS', P, 'dBTP')
assert mix.shape[0] == N
sf.write(os.path.join(HERE, 'mix.wav'), mix.astype(np.float32), SR, subtype='PCM_24')
# the sampled instruments this mix used (demo/CREDITS lists them with their libraries and licences)
print('instruments:', ', '.join(sorted(used)))
for l in S.credits(sorted(used)): print('  ' + l)
print('mix.wav', mix.shape[0] / SR, 's', 'true peak', round(20 * np.log10(tp), 2), 'dBTP; instruments:', len(used))
