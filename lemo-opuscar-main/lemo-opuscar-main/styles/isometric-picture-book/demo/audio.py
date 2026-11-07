# Narration + score + foley for 七十二个座位. Run from the library root (build.sh does):
#   .venv/bin/python <demo>/audio.py <demo>                                 Chinese: out/vo_zh → mix.wav
#   .venv/bin/python <demo>/audio.py <demo> --vo out/vo_en --out mix_en.wav   English narration, same score and foley
# The narration sits on top; the music ducks about 16 dB under it and comes back up in the gaps; foley stays but never covers the voice.
import sys, os, json, subprocess, re
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
sys.path.insert(0, '.')
from core.audio import sampler as S
from core.audio.sfx import SR, add, limit, lp, hp, bp, noise, brown, t_, env_exp, click, clack, thump, whoosh

P = sys.argv[1]
ARG = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
VODIR, OUT = ARG('--vo', 'out/vo_zh'), ARG('--out', 'mix.wav')
EV = json.load(open(os.path.join(P, 'events.json')))['ev']
TL = next(e for e in EV if e['type'] == 'timeline'); T, SH = TL['T'], TL['S']
DUR = T['DUR']; N = int(round(DUR * SR))
S.seed(11)
ev = lambda kind: [e for e in EV if e['type'] == kind]
sh = lambda i: SH[i - 1]

# ---------------- narration ----------------
vo = np.zeros(N, np.float32); VLEN = {}
for e in ev('vo'):
    x, sr = sf.read(os.path.join(P, VODIR, e['id'] + '.wav'), dtype='float32')
    if sr != SR: x = resample_poly(x, SR, sr).astype(np.float32)
    VLEN[e['id']] = len(x) / SR
    a = int(e['t'] * SR); b = min(N, a + len(x)); vo[a:b] += x[:b - a]
# a gentle presence lift and a soft compressor so every line sits at the same level
vo = vo + .25 * hp(vo, 2500); vo /= np.abs(vo).max() + 1e-9
# ducking envelope: 1 where the voice speaks (with .12 s attack, .45 s release)
act = np.zeros(N, np.float32)
for e in ev('vo'): act[int(max(0, e['t'] - .12) * SR):int(min(DUR, e['t'] + VLEN[e['id']] + .05) * SR)] = 1
k = int(.45 * SR); ker = np.ones(k) / k; duck = np.convolve(act, ker, 'same').clip(0, 1)
music_gain = 10 ** (-16 * duck / 20)

# ---------------- score ----------------
sc = []
def n(t, inst, p, d, v, pan=0, g=1): sc.append((t, inst, p, d, v, pan, g))
def chord(t, ps, d, v, inst='upright', pan=.1, strum=.04):
    for i, p in enumerate(ps): n(t + i * strum, inst, p, d, v, pan)
CH = {'F': (['F2', 'C3'], ['A3', 'C4', 'F4', 'G4']), 'Bb': (['Bb1', 'F2'], ['A3', 'D4', 'F4']), 'FA': (['A2', 'F3'], ['C4', 'F4', 'A4']),
      'Dm': (['D2', 'A2'], ['F3', 'A3', 'C4', 'E4']), 'C': (['C2', 'G2'], ['E3', 'G3', 'C4', 'D4']), 'Gm': (['G2', 'D3'], ['F3', 'Bb3', 'D4'])}
def bar(t, name, d, v=.36):
    b, u = CH[name]; chord(t, b, d, v + .06, pan=-.1, strum=0); chord(t + .02, u, d, v)
B = .6
bar(0, 'F', 3.4, .36); bar(sh(2)[0], 'Bb', 2.6, .32); bar(sh(2)[0] + 2.6, 'F', 2.6, .3)
t = T['STAND0'] + .3; i = 0; walk = ['F4', 'A4', 'C5', 'A4', 'G4', 'Bb4', 'D5', 'Bb4']
while t < sh(4)[0] - .1:
    n(t, 'violins_pizz', walk[i % 8], .3, .3 if i % 2 else .38, -.25)
    if i % 2 == 0: n(t, 'contrabass_pizz', ['F2', 'D2', 'Bb1', 'C2'][(i // 4) % 4], .5, .42, -.05)
    t += B / 2; i += 1
bar(sh(3)[0], 'C', 1.6, .3)
for j, p in enumerate(['C4', 'D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5']): n(T['LID0'] + .1 + j * .05, 'harp', p, 1.4, .3, .25)
bar(T['SETTLE'], 'F', 2.4, .32)
# 4: stuck — a pizzicato stab when the person stops, a held cello D under the wait
n(sh(4)[0] + .5, 'violins_pizz', 'D3', .3, .5, .15); n(sh(4)[0] + .5, 'violins_pizz', 'A3', .3, .45, .15); n(sh(4)[0] + .5, 'contrabass_pizz', 'D2', .5, .5)
n(sh(4)[0] + 1.0, 'violins_pizz', 'E3', .3, .4, .15); n(sh(4)[0], 'cellos', 'D2', sh(5)[1] - sh(4)[0], .2)
bar(sh(5)[0], 'Dm', 2.8, .28); bar(sh(5)[0] + 2.8, 'Bb', 2.6, .28)
t = T['FAST0']; i = 0; run = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5']
while t < T['FAST1'] - .05: n(t, 'piano', run[i % 8], .2, .28 + .1 * (i % 4 == 0), .2); t += B / 4; i += 1
bar(T['FAST1'], 'Dm', 2.4, .4); n(T['FAST1'], 'cellos', 'D2', 2.6, .3)
# 7: the new order lights up — a rising glockenspiel run across the seats
for j in range(12): n(T['LIGHT0'] + j * .12, 'glockenspiel', ['F5', 'A5', 'C6', 'F6'][j % 4], .6, .14 + .01 * j, .3)
bar(sh(8)[0], 'F', 2.1, .3); bar(sh(8)[0] + 2.1, 'C', 2.1, .28)
for j, p in enumerate(['F4', 'A4', 'C5', 'F5']): n(sh(8)[0] + .05 + j * .3, 'vibraphone', p, 1.2, .3, .2)
WV = [['F3', 'A3', 'C4', 'F4', 'A4', 'C5'], ['Bb2', 'F3', 'Bb3', 'D4', 'F4', 'A4'], ['C3', 'G3', 'C4', 'E4', 'G4', 'D5'], ['D3', 'A3', 'D4', 'F4', 'A4', 'C5'],
      ['F3', 'C4', 'F4', 'A4', 'C5', 'E5'], ['G2', 'D3', 'G3', 'Bb3', 'D4', 'F4'], ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'], ['A2', 'E3', 'A3', 'C4', 'E4', 'G4'],
      ['Bb2', 'F3', 'Bb3', 'D4', 'F4', 'C5'], ['C3', 'G3', 'E4', 'G4', 'Bb4', 'C5'], ['D3', 'A3', 'F4', 'A4', 'C5', 'E5'], ['F3', 'C4', 'F4', 'A4', 'C5', 'F5']]
for e in ev('wave'):
    for j, p in enumerate(WV[e['k']]): n(e['t'], 'vibraphone', p, .8 if e['fast'] else 1.3, (.24 if e['fast'] else .3) + .02 * j, -.3 + .12 * j)
    n(e['t'], 'contrabass_pizz', S.name(S.midi(WV[e['k']][0]) - 12), .6, .45, -.05)
t = T['WV0'] + .3; i = 0
while t < T['WV_END']:
    n(t, 'violins_pizz', ['C5', 'A4', 'F4', 'A4'][i % 4], .25, .22, -.3)
    sc.append((t, 'shaker', 'down' if i % 2 == 0 else 'up', None, .14 if i % 2 else .2, .35, 1)); t += B / 2; i += 1
for e in ev('stop')[1:]: n(e['t'], 'glockenspiel', 'F6', 1.6, .3, .3); bar(e['t'], 'F', 3.0, .34)
bar(sh(11)[0], 'Bb', 2.0, .28); bar(sh(11)[0] + 2.0, 'Gm', 2.4, .28)
for e in ev('bracket'): n(e['t'], 'glockenspiel', 'C6', 1.6, .26, .3); bar(e['t'], 'C', 1.6, .3)
bar(sh(12)[0], 'FA', 5.0, .3)
bar(sh(13)[0], 'Dm', 5.2, .3)
bar(sh(14)[0], 'F', DUR - sh(14)[0] + .4, .34); n(sh(14)[0], 'cellos', 'F2', DUR - sh(14)[0], .22)
for e in ev('char'):
    if e['p'] == 'end': n(e['t'], 'vibraphone', ['F4', 'A4', 'C5', 'F5', 'A5'][e['i'] % 5], 1.6, .34, .2); continue
    n(e['t'], 'vibraphone', ['C5', 'A4', 'G4', 'F4', 'D5', 'C5'][e['i'] % 6], .9, .26 if e['big'] else .16, .2)
    if e['acc']: n(e['t'], 'glockenspiel', 'C6', 1.0, .16, .25)
# a soft sustained cello root under every shot, overlapping each cut, so no scene change drops out
ROOT = ['F2', 'F2', 'C2', 'D2', 'D2', 'D2', 'F2', 'C2', 'F2', 'F2', 'G2', 'F2', 'D2', 'F2']
for j, (a, b) in enumerate(SH): n(max(0, a - .15), 'cellos', ROOT[j], b - a + .6, .16, 0)
mus = S.render(sc, dur=DUR + 3)
mus = S.room(mus, size=.45, mix=.2)
mus = mus[:N] if len(mus) >= N else np.pad(mus, ((0, N - len(mus)), (0, 0)))
r0 = int(T['REW0'] * SR); rl = int(1.0 * SR)                       # rewind: the second before, backwards
mus[r0:r0 + rl] = mus[r0:r0 + rl] * .3 + mus[r0 - rl:r0][::-1] * np.linspace(.4, 1, rl)[:, None]

# ---------------- foley ----------------
fx = np.zeros((N, 2), np.float32)
def put(x, t, g=1., pan=0.): add(fx, np.asarray(x, np.float32), t, g, pan)
def nz(x): m = np.abs(x).max(); return x / m if m > 0 else x
def bed(t0, t1, x, g, fade=.5):
    a, b = int(t0 * SR), min(N, int(t1 * SR)); L = b - a
    if L <= 0: return
    y = x[:L]; e = np.minimum(1, np.minimum(np.arange(L) / (fade * SR), (L - np.arange(L)) / (fade * SR)))
    fx[a:b, 0] += (y * e * g).astype(np.float32); fx[a:b, 1] += (np.roll(y, 911)[:L] * e * g).astype(np.float32)
apronbed = nz(lp(brown(DUR + 1), 300)) + .25 * nz(bp(noise(DUR + 1), 380, 460))
hall = nz(lp(brown(DUR + 1), 900)) * .7 + .12 * nz(bp(noise(DUR + 1), 300, 2400))
cabin = nz(bp(noise(DUR + 1), 180, 1600))
inside = [(3, 7), (9, 11), (13, 14)]   # shot ranges inside the cabin
bed(0, sh(2)[0] + .8, apronbed, .045); bed(sh(2)[0], sh(3)[0] + .5, hall, .045)
for a, b in inside: bed(sh(a)[0] - .3, sh(b)[1] + .3, cabin, .03)
bed(sh(8)[0] - .3, sh(8)[1] + .3, hall, .045); bed(sh(11)[0] - .3, sh(13)[0] + .3, apronbed, .045); bed(sh(14)[0] - .3, DUR, apronbed, .045)
d = 3.2; tt = t_(d); whine = np.sin(2 * np.pi * np.cumsum(np.linspace(3600, 2400, len(tt))) / SR) * np.exp(-tt / 1.4)
roar = nz(lp(brown(d), 220)) * np.minimum(1, (d - tt) / 1.2)
for j in range(8): add(fx, ((whine * .25 + roar)[j * len(tt) // 8:(j + 1) * len(tt) // 8] * .1).astype(np.float32), j * d / 8, 1, -.7 + .09 * j)
for e in ev('brake'): put(nz(hp(noise(.5), 2600)) * env_exp(.5, .12), e['t'], .04, -.1)
for e in ev('dock'): put(thump(.8, 60), e['t'], .16, .2)
for e in ev('swish'): put(whoosh(.6, .7), e['t'], .04, 0)
def chime(f1, f2):
    d = 1.6; tt = t_(d); a = np.sin(2 * np.pi * f1 * tt) * np.exp(-tt / .5); b = np.sin(2 * np.pi * f2 * tt) * np.exp(-tt / .7)
    return nz(a + np.pad(b, (int(.32 * SR), 0))[:len(tt)] + .2 * np.sin(2 * np.pi * 2 * f1 * tt) * np.exp(-tt / .2))
for e in ev('chime'): put(chime(1046.5, 880), e['t'], .06, .35)
for e in ev('sign'): put(click(1.2, .8), e['t'], .05, -.3)
for e in ev('stand'): put(thump(.3, 140) * .6, e['t'], .02, -.35 + e['q'] * .02)
wheels = nz(bp(noise(DUR + 1), 900, 4000)) * (1 + .3 * np.sin(2 * np.pi * 3 * t_(DUR + 1)))
bed(T['STAND0'] + .6, sh(3)[1], wheels, .015)
for e in ev('lid_open'): s = nz(bp(noise(.7), 800, 5000)) * np.sin(np.pi * t_(.7) / .7); put(s, e['t'], .04, -.2)
for e in ev('lid_rest'): put(thump(.5, 90), e['t'], .05, -.3)
for e in ev('stop_mark'): put(clack(1.0, 1), e['t'] + .1, .1, -.3)
for e in ev('bin_slap'): put(thump(.6, 120), e['t'], .1, -.2)
for e in ev('fast'):
    t = e['t']; dt = .14
    while t < T['FAST1']: put(click(1.6, .5), t, .025, .3); t += dt; dt = max(.045, dt * .9)
def beep(f=2400, d=.18): tt = t_(d); return np.sin(2 * np.pi * f * tt) * np.minimum(1, (d - tt) / .02)
for e in ev('stop'): put(beep(), e['t'], .04, .3)
for e in ev('rewind'): w = nz(bp(noise(1.0), 300, 6000)) * (t_(1.0) / 1.0) ** 2; put(w, e['t'], .05, 0)
for e in ev('wave'):
    for j in range(6): put(click(.9 + .05 * j, .4), e['t'] + .02 * j, .02 if e['fast'] else .035, -.4 + .16 * j)
for e in ev('bins_shut'): put(clack(1.1, 1), e['t'], .05 if e['k'] > 2 else .08, 0)
for e in ev('seated'): put(thump(.25, 130), e['t'], .03, 0)
for e in ev('pull'): put(whoosh(1.0, .8), e['t'], .05, 0)
for e in ev('bar'): s = nz(bp(noise(.5), 1500, 6000)) * np.sin(np.pi * t_(.5) / .5); put(s, e['t'], .02, -.1)
for e in ev('crowd'): [put(thump(.2, 160), e['t'] + j * .06, .015, -.3 + j * .05) for j in range(12)]
for e in ev('band'): s = nz(bp(noise(.5), 800, 3000)) * np.sin(np.pi * t_(.5) / .5); put(s, e['t'], .02, 0)

# ---------------- mix + loudness ----------------
# set the music bus so that, ducked, it sits 16.5 dB under the voice
m = act[:N] > 0
vr = 20 * np.log10(np.sqrt(np.mean((vo[m] * .9) ** 2)) + 1e-9); mr0 = 20 * np.log10(np.sqrt(np.mean((mus[m] * music_gain[m, None]) ** 2)) + 1e-9)
MG = 10 ** ((vr - 16.5 - mr0) / 20)
music = mus * music_gain[:, None] * MG + fx * (1 - .45 * duck[:, None])
mix = np.stack([vo, vo], 1) * .9 + music
fade = int(.25 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
def measure(x):
    tmp = os.path.join(P, '.measure.wav'); sf.write(tmp, x.astype(np.float32), SR)
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', tmp, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    os.remove(tmp)
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1]), float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', out)[-1])
raw = mix.copy(); ceil = -2.4
for _ in range(6):
    I, tp = measure(raw); mix = limit(raw * 10 ** ((-16 - I) / 20), 10 ** (ceil / 20)); I, tp = measure(mix)
    if tp <= -1.6: break
    ceil -= .5
mix = mix[:N].astype(np.float32)
sf.write(os.path.join(P, OUT), mix, SR)
# how far the music sits under the voice: RMS of music vs voice where the voice speaks
mr = 20 * np.log10(np.sqrt(np.mean((mus[m] * music_gain[m, None] * MG) ** 2)) + 1e-9)
w = int(.5 * SR); rms = [20 * np.log10(np.sqrt(np.mean(mix[i:i + w] ** 2)) + 1e-9) for i in range(0, N - w, w)]
print(f'{OUT} {len(mix) / SR:.2f}s  integrated {I:.1f} LUFS  true peak {tp:.1f} dBFS  music under voice {vr - mr:.1f} dB  quietest 0.5 s {min(rms[:-1]):.1f} dBFS at {int(np.argmin(rms[:-1])) * .5:.1f}s (last window is the fade)')
print('\n'.join(S.credits(sorted({e[1] for e in sc}))))
