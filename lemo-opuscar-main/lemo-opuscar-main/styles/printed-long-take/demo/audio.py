"""Narration, score and sound for 三十三只 Thirty-Three Cranes (60.0 s). Reads events.json (export first:
node core/render/events.mjs styles/printed-long-take/demo) and the narration in voice/<lang>/ (edge-tts, see build.sh), writes
mix.wav (48 kHz stereo, exactly the film length, about -16 LUFS, true peak under -1.5 dBTP) and prints the CREDITS lines.
Run from the library root:
    .venv/bin/python styles/printed-long-take/demo/audio.py        English narration (voice/en/), the library demo
    .venv/bin/python styles/printed-long-take/demo/audio.py zh     Chinese narration (voice/zh/)
The narration leads; music is ducked about 17 dB under it and foley about 7 dB. Three layers under the voice. The world: the
river under its ice edge, frost, wind, wings, snow, pecking, the cranes' calls (synthesised). The print: knife on paper and wood,
the block's thump, the sheet torn away, the seal. Music: 72 bpm in three, D minor to D major; bowed vibraphone and harp at
night, the horn's theme at dawn, xylophone and pizzicato bass in the air, strokes for the prints, horn in the major after the
seal, three glockenspiel notes on the end card."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); LANG = 'zh' if 'zh' in sys.argv[1:] else 'en'; LIB = os.path.abspath(os.path.join(HERE, '../../..')); sys.path.insert(0, LIB)
import numpy as np, soundfile as sf
from core.audio import sampler as S, sfx as X
from core.audio.sfx import SR, add, limit, noise, bp, lp, hp, env_exp, t_, norm, thump, brown

X._rng = np.random.default_rng(33); S.seed(33); R = np.random.default_rng(1952)
E = json.load(open(os.path.join(HERE, 'events.json'))); DUR = E['dur']; EV = E['ev']; N = int(round(DUR * SR))
ev = lambda ty: [e for e in EV if e['type'] == ty]
one = lambda ty: ev(ty)[0]['t']
tt = np.arange(N) / SR
# the picture slows down through the bridge (timeline.js WARP): fixed times written below are in the
# unslowed timeline and go through nt(); times read from events.json are already film time
WA, WB, WD = 9.95, 11.75, .4
def ot(t):   # film time -> unslowed time
    if t <= WA: return t
    if t >= WB: return t - WD
    u = (t - WA) / (WB - WA); return t - WD * (u - np.sin(2 * np.pi * u) / (2 * np.pi))
def nt(x):   # unslowed time -> film time
    if x <= WA: return x
    lo, hi = x, x + WD
    for _ in range(40):
        mid = (lo + hi) / 2
        if ot(mid) < x: lo = mid
        else: hi = mid
    return (lo + hi) / 2
c0 = 0.0
mus = np.zeros((N, 2), np.float32); fx = np.zeros((N, 2), np.float32); amb = np.zeros((N, 2), np.float32)

def add(buf, x, at, gain=1.0, pan=0.0):   # stereo arrays go straight in; mono ones are panned by sfx.add
    if x.ndim == 1: return X.add(buf, x, at, gain, pan)
    s = int(round(at * SR)); e = min(len(buf), s + len(x))
    if e > s >= 0: buf[s:e] += x[:e - s] * gain
def env(a, b, fi=.3, fo=.3):
    return np.clip((tt - a) / max(fi, 1e-3), 0, 1) * np.clip((b - tt) / max(fo, 1e-3), 0, 1)
def st(x, g=1., pan=0.):   # mono → stereo (constant power)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l * g, x * r * g], 1).astype(np.float32)

# ================================================================== the world
# the river: low gurgle under the ice edge, little bubbling knocks
river = lp(brown(DUR + .1), 420)[:N] * .5 + bp(noise(DUR + .1), 300, 1400)[:N] * .05
bub = np.zeros(N)
for t in np.arange(0, DUR, .11):
    if R.random() < .5:
        f = 380 + R.random() * 500; d = .06; s = t_(d)
        x = np.sin(2 * np.pi * f * s * (1 + s * 6)) * env_exp(d, .015)
        i = int(t * SR); bub[i:i + len(x)] += x[:max(0, min(len(x), N - i))] * (.05 + R.random() * .05)
river = norm(river + bub, .5)
gain_r = (.32 + .3 * env(5.0, nt(16.7), 1.0, 1.5)) * (1 - env(nt(18.6), nt(24.0), .2, .2)) * (1 - env(nt(24), nt(55.6), .3, 1.5) * .85)
amb += st(river * gain_r, 1., -.1) + st(np.roll(river, 9000) * gain_r, .8, .3)
# wind: a thin high hiss at night, a broad wind in the air, a steady breeze over the field
w = noise(DUR + .1)[:N]
night_w = hp(lp(w, 2600), 900) * .05 * (1 - env(nt(17), DUR, .5, .1))
air_w = bp(w, 200, 1800) * .32 * env(one('air'), nt(24.2), .15, .6)
field_w = bp(w, 300, 2400) * .06 * env(nt(24), DUR, .8, 1.5)
amb += st(night_w + air_w + field_w, 1., .0)
# under the bridge: everything closes in, a hollow ring
ub = one('underBridge')
amb *= (1 - .55 * env(ub, ub + .55, .15, .2))[:, None]
add(fx, st(lp(noise(.9), 300) * env_exp(.9, .4), .35), ub, 1.)
# frost cracks in the branches
def crack(v=1.):
    d = .12; return norm(hp(noise(d), 2500) * env_exp(d, .01) + np.sin(2 * np.pi * 3100 * t_(d)) * env_exp(d, .004) * .4) * v
for e in ev('frostcrack'): add(fx, st(crack(), .2, R.uniform(-.7, .7)), e['t'])

# the cranes: a bugle-like voice, synthesised (no recording used)
def crane_voice(dur, f0, v=1., glide=.12):
    s = t_(dur); f = f0 * (1 - glide + glide * np.minimum(1, s / .05)) * (1 - .05 * s / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(a * np.sin(k * ph) for k, a in [(1, 1), (2, .55), (3, .45), (4, .25), (5, .18), (6, .1)])
    x = bp(x, 700, 4200)
    a = np.minimum(1, s / .015) * np.minimum(1, (dur - s) / .05)
    return norm(x * a * (1 + .15 * np.sin(2 * np.pi * 28 * s)), 1.) * v
def unison(at, v=1., pan=0.):   # the male's long low note, the female's two short high ones, three times
    for k in range(3):
        b = at + k * .62
        add(fx, st(crane_voice(.44, 780, 1.), .5 * v, pan - .2), b)
        add(fx, st(crane_voice(.15, 1080, 1.), .42 * v, pan + .2), b + .2)
        add(fx, st(crane_voice(.15, 1120, 1.), .42 * v, pan + .2), b + .4)
add(fx, st(crane_voice(.22, 720, 1., .05), .1, .3), one('sleepcall'))       # one murmurs in its sleep
unison(one('unison'), 1.0, -.3)
for k in range(9):   # the river answers
    t = one('calls') + k * .38 + R.random() * .2
    add(fx, st(crane_voice(.2 + R.random() * .2, 850 + R.random() * 350), .12 + R.random() * .08, R.uniform(-.9, .9)), t)
# wings: a soft beat of air
def flap(v=1.):
    d = .22; s = t_(d); return norm(bp(noise(d), 120, 900) * np.sin(np.pi * np.minimum(1, s / d)) ** 2, 1.) * v
def slap(v=1.):
    d = .09; return norm(bp(noise(d), 600, 4000) * env_exp(d, .015), 1.) * v
to = one('takeoff')
for k in range(46):   # running across the water, then lifting off
    t = to + k * .05 + R.random() * .02
    for j in range(5): add(fx, st(slap(), .07, R.uniform(-.6, .6)), t + j * .085)
    for j in range(5): add(fx, st(flap(), .2 * (1 - k / 60), R.uniform(-.7, .7)), t + .55 + j * .44)
# the steam swallows the sound for half a second; in the air, a steady wing beat
wb = one('air')
fx *= (1 - .9 * env(one('steam') - .05, wb + .25, .15, .2))[:, None]
for t in np.arange(wb + .2, nt(24.0), .44): add(fx, st(flap(), .16, -.2), t); add(fx, st(flap(), .1, .3), t + .21)
# the descent: the wings brake, birds touch down on snow, the field talks
add(fx, st(lp(noise(1.1), 900) * np.sin(np.pi * np.minimum(1, t_(1.1) / 1.1)), .3, .1), one('descend') + .3)
def crunch(v=1.):
    d = .12; return norm(bp(noise(d), 500, 5000) * env_exp(d, .03) * (1 + (np.random.default_rng(int(v * 1000)).random(int(d * SR)) > .7)), 1.) * v
add(fx, st(crunch(), .35, 0), one('touchdown'))
add(fx, st(flap(), .3, 0), one('touchdown') - .25)
for e in ev('land'): add(fx, st(crunch(), .12, e.get('pan', 0)), e['t']); add(fx, st(flap(), .1, e.get('pan', 0)), e['t'] - .2)
for t in np.arange(nt(24.4), DUR - 1.5, .23):   # the field: pecking and murmurs, thinned out under the type
    quiet = nt(41.3) < t < nt(48.6)
    if R.random() < (.25 if quiet else .55):
        d = .03; s = t_(d); x = np.sin(2 * np.pi * (900 + R.random() * 400) * s) * env_exp(d, .006)
        add(fx, st(x, .05, R.uniform(-.8, .8)), t)
    if R.random() < (.04 if quiet else .12):
        add(fx, st(crane_voice(.18 + R.random() * .2, 820 + R.random() * 360), .05 + R.random() * .05, R.uniform(-.9, .9)), t)
for e in ev('danceflap'): add(fx, st(flap(), .35, .2), e['t']); add(fx, st(flap(), .3, .2), e['t'] + .3)

# ================================================================== the print
def scrape(d, v=1., f0=2500, f1=6000):   # a knife drawn through paper or wood
    s = t_(d); x = bp(noise(d), f0, f1) * (.6 + .4 * np.abs(np.sin(2 * np.pi * 37 * s)))
    return norm(x * np.minimum(1, s / .01) * np.minimum(1, (d - s) / .03), 1.) * v
c0 = one('carveTitle')
for k in range(5): add(fx, st(scrape(.16 + R.random() * .1), .16, .2 + k * .08), c0 + k * .22)
for k in range(3): add(fx, st(scrape(.14), .08, .4), one('uncarveTitle') + k * .25)
for k in range(11):   # the dawn is cut into the sky, one line at a time
    add(fx, st(scrape(.35 + R.random() * .3, 1., 1800, 5200), .06, R.uniform(-.6, .6)), nt(11.2 + k * .42 + R.random() * .1))
def block(v=1.):   # the inked block meets the paper
    x = thump(1, 62).copy(); y = lp(noise(.25), 400) * env_exp(.25, .05) * .5; x[:len(y)] += y[:len(x)]
    return norm(x, 1.) * v
def tear(v=1.):
    d = .32; s = t_(d); x = bp(noise(d), 900, 7000) * (np.random.default_rng(3).random(len(s)) > .45) * np.sin(np.pi * s / d) ** .5
    return norm(x, 1.) * v
add(fx, st(block(), .45), one('print0'))
for i, e in enumerate(ev('peel')):
    add(fx, st(tear(), .3 + .05 * i, .3), e['t']); add(fx, st(block(), .5 + .08 * i), e['t'] + .27)
add(fx, st(lp(noise(1.2), 2500) * np.sin(np.pi * t_(1.2) / 1.2) ** 2 * .5, .25, -.2), one('corn'))   # corn thrown on the snow
for e in ev('redplate'): add(fx, st(block(), .22, .2), e['t'])                                       # the red plate pressed on
for e in ev('knife'): add(fx, st(scrape(.09, 1., 3000, 8000), .22, -.1), e['t']); add(fx, st(crack(), .05, -.1), e['t'] + .07)
add(fx, st(scrape(.32, 1., 1500, 4500), .3, -.2), one('strike'))
stp = one('stamp')
add(fx, st(thump(1, 48), 1.0), stp); add(fx, st(lp(noise(.3), 260) * env_exp(.3, .08), .6), stp)
unison(stp + .45, .7, .25)

# ================================================================== music: 72 bpm, three beats to a bar
B = 60 / 72
sc = []
def n(t, inst, p, d, v, pan=0., g=1.): sc.append((t, inst, p, d, v, pan, g))
# night: bowed vibraphone high and still, a bass pedal, the harp's three-note figure from the river onwards
n(0, 'vibraphone_bowed', 'A5', nt(11.5), .3, .3, .55)
for t0, ch in ((0, ['D4', 'F4', 'A4']), (5.0, ['D4', 'G4', 'Bb4']), (8.4, ['C4', 'F4', 'A4'])):
    for i, p in enumerate(ch): n(t0 + i * .05, 'vibraphone_bowed', p, 4.6 if t0 < 8 else nt(12.8) - 8.4, .3, -.3 + .3 * i, .5)
n(0, 'contrabass', 'D2', nt(12.5), .3, 0, .4)
for k, p in enumerate(['D6', 'A5', 'F6', 'E6']): n(c0 + .08 + k * .27, 'glockenspiel', p, 1.4, .22, .35)
harp = ['D4', 'A4', 'F5', 'D4', 'A4', 'E5', 'C4', 'G4', 'E5', 'Bb3', 'F4', 'D5']
k = 0; t = 5.5
while t < 17.0:
    n(nt(t), 'harp', harp[k % 12], .9, .3 + (.08 if k % 3 == 0 else 0), .25 * ((k % 3) - 1), .8); t += B; k += 1
# dawn: the horn's theme (D dorian), first statement
theme = [('A3', 1), ('D4', 2), ('E4', 1), ('F4', 1.5), ('E4', .5), ('D4', 1), ('C4', 1), ('D4', 3)]
t = 13.6
for p, b in theme: n(nt(t), 'horn', p, b * B * .95, .5, -.15, .9); t += b * B
n(nt(11.5), 'contrabass', 'D2', 5.2, .3, 0, .45); n(nt(11.5), 'cellos', 'A2', 5.0, .28, .2, .5)
for t0, p in ((14.0, 'D6'), (15.2, 'A5')): n(nt(t0), 'hand_chimes', p, 2.0, .18, .4)
# takeoff swell, then the steam cuts it
n(nt(16.2), 'timpani', 'D2', 2.4, .35, 0, .5)
for i, p in enumerate(['D3', 'A3', 'D4', 'F4']): n(nt(16.4) + i * .05, 'violins_trem' if i > 1 else 'violas', p if i > 1 else p, 2.2, .3 + .05 * i, -.3 + .2 * i, .5)
# the air: xylophone and pizzicato bass in a steady three
bars = [('D2', ['D5', 'A5', 'F5']), ('Bb1', ['D5', 'F5', 'Bb5']), ('C2', ['E5', 'G5', 'C6']), ('A1', ['C#5', 'E5', 'A5'])]
t = one('air') + .1; k = 0
while t < nt(24.6):
    bass, top = bars[k % 4]
    n(t, 'contrabass_pizz', bass, 1.0, .55, -.1, .9)
    for j in range(3): n(t + j * B, 'xylophone', top[j], .4, .32 + (.08 if j == 0 else 0), .25, .7)
    t += 3 * B; k += 1
# the field: the music thins to one low string
n(nt(24.6), 'cellos', 'D3', 3.5, .25, 0, .45); n(nt(26.5), 'contrabass', 'D2', 6.2, .28, 0, .5)
n(nt(28.6), 'vibraphone_bowed', 'F4', 3.8, .22, -.2, .4)
# the prints: four strokes, each closer than the last (the block thumps sit on them)
for t0, p in zip([one('print0'), one('corn')] + [e['t'] + .27 for e in ev('peel')], ['D2', 'F2', 'D2', 'A1', 'D2']):
    n(t0, 'timpani', p, 1.2, .5, 0, .7); n(t0, 'contrabass_pizz', p, .8, .5, 0, .7)
# the verdict: one held note under the cutting, silence before the seal, then the theme in D major
n(nt(41.3), 'contrabass', 'A1', 7.0, .26, 0, .45)
n(stp, 'gran_cassa', None, None, .7, 0, .8)
for i, p in enumerate(['D3', 'A3', 'F#4', 'A4']): n(stp + .55 + i * .03, 'violas' if i < 2 else 'violins', p, 6.5, .32, -.3 + .2 * i, .5)
majr = [('A3', 1), ('D4', 2), ('E4', 1), ('F#4', 1.5), ('G4', .5), ('A4', 1), ('B4', 1), ('A4', 2), ('F#4', 1), ('D4', 3)]
t = stp + .9
for p, b in majr: n(t, 'horn', p, b * B * .95, .52, -.15, .9); t += b * B
n(stp + .6, 'contrabass', 'D2', 7.0, .3, 0, .5)
for k in range(12): n(nt(51.4) + k * B, 'harp', ['D4', 'A4', 'F#5', 'D5'][k % 4], 1.0, .28, .2, .7)
# the long chord, and three glockenspiel notes on the end card
end = one('endcard')
for i, p in enumerate(['D3', 'A3', 'D4', 'F#4', 'A4']): n(end - .6, 'violins' if i > 2 else 'cellos', p, 3.6, .3, -.3 + .15 * i, .45)
n(end - .6, 'horn', 'D4', 3.4, .42, -.1, .7)
for k, p in enumerate(['A5', 'F#5', 'D6']): n(end + .1 + k * .5, 'glockenspiel', p, 2.5, .28, .3)

mus += S.render(sc, dur=DUR)[:N]
mus = S.room(mus, size=.6, mix=.22)
fx = S.room(fx, size=.35, mix=.12)

# ================================================================== mix: music under the effects, a quiet tail
vo = np.zeros(N, np.float32)
for e in ev('vo'):
    x, sr = sf.read(os.path.join(HERE, 'voice', LANG, e['id'] + '.wav'), dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    x = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x).astype(np.float32)
    i = int(e['t'] * SR); vo[i:i + len(x)] += x[:max(0, N - i)]
vo = vo / max(1e-6, np.sqrt(np.mean(vo[np.abs(vo) > 1e-4] ** 2))) * .1   # speech at a fixed level
# ducking: a smoothed speech envelope, held through the pauses inside a line
ve = np.convolve((np.abs(vo) > .003).astype(np.float32), np.ones(int(.35 * SR)) / int(.35 * SR), 'same')
ve = np.clip(ve * 4, 0, 1)
k = int(.25 * SR); ve = np.maximum.accumulate(np.r_[ve, np.zeros(k)])[:N] * 0 + np.convolve(ve, np.ones(k) / k, 'same')
ve = np.clip(ve, 0, 1)
duck_m = 10 ** (-17 / 20) * ve + (1 - ve)
duck_f = 10 ** (-7 / 20) * ve + (1 - ve)
mix = mus * .62 * duck_m[:, None] + fx * .9 * duck_f[:, None] + amb * .55 * duck_f[:, None] + st(vo, 1.4)
tail = np.clip((DUR - tt) / 1.4, 0, 1) ** 1.5
head = np.clip(tt / .04, 0, 1)
mix *= (tail * head)[:, None]
# loudness to about -16 LUFS (measured with ffmpeg), then a ceiling for true peak
tmp = os.path.join(HERE, 'mix.wav')
def lufs(x):
    sf.write(tmp, x, SR, subtype='PCM_24')
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', tmp, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    I = float(out.split('Integrated loudness:')[1].split('I:')[1].split('LUFS')[0]); P = float(out.split('True peak:')[1].split('Peak:')[1].split('dBFS')[0])
    return I, P
for _ in range(3):
    I, P = lufs(limit(mix, .6))
    mix *= 10 ** ((-16 - I) / 20)
base, ceil = mix.copy(), -2.2
for _ in range(8):   # the limiter works on samples; walk its ceiling down until the true peak (between samples) is under -3
    mix = limit(base, 10 ** (ceil / 20)); I, P = lufs(mix)
    mix *= 10 ** ((-16 - I) / 20); mix = limit(mix, 10 ** (ceil / 20)); I, P = lufs(mix)
    if P <= -1.7: break
    ceil -= .5
assert len(mix) == N
print(f'{os.path.basename(tmp)}  {DUR:.2f} s  {I:.1f} LUFS  true peak {P:.1f} dBFS')
print('\n'.join(S.credits(sorted({e[1] for e in sc}))))
