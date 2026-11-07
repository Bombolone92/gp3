"""mix.py · voice + score + foley + ambience → out/mix.wav, for the [a, b) stretch of the whole-film clock.
  .venv/bin/python styles/silkscreen-poster/demo/mix.py [a b]      (default 0 50)
Sync points come from events.json (node core/render/events.mjs, whole film), the score from music/score.wav,
the voice from out/voice/*.wav (Kokoro, made by build.sh) at the times in voice/cues.json.
Foley by material: squeegee = rubber blade over nylon mesh (band-passed noise with a ~250 Hz mesh grain, faster = brighter);
ink = a wet low squelch; screen = aluminium frame clack + hinge creak; stats = paper stamps + ticks.
Balance: voice compressed, then set ~10 dB (RMS) over the music; music dips 300 Hz–4 kHz and ducks under the voice."""
import json, os, sys
import numpy as np, soundfile as sf
D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('LIB') or os.path.abspath(os.path.join(D, '../../..'))
sys.path.insert(0, os.path.join(ROOT, 'core/audio'))
from sfx import SR, t_, env_exp, bp, lp, hp, noise, norm, brown, clack, creak, thump, whoosh, compress, limit, add
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

A = float(sys.argv[1]) if len(sys.argv) > 2 else 0.0
Bt = float(sys.argv[2]) if len(sys.argv) > 2 else 50.0
EVJ = json.load(open(os.path.join(D, 'events.json')))
EV = EVJ['ev']
TOT = 50.0 + 2
N = int(TOT * SR)
rng = np.random.default_rng(11)
amb = np.zeros((N, 2)); fol = np.zeros((N, 2)); vox = np.zeros((N, 2))
tt = np.arange(N) / SR
def evs(tp, **kw): return [e for e in EV if e['type'] == tp and all(e.get(k) == v for k, v in kw.items())]

# ---------------- foley building blocks ----------------
def scrape(d, bright=1.0, heavy=0.0, attack=.02):
    n = noise(d); x_t = t_(d)
    grain = .65 + .35 * np.abs(np.sin(2 * np.pi * (230 + 50 * bright) * x_t + rng.random() * 6)) ** 2
    x = bp(n, 700 * bright, min(9000, 5200 * bright), 2) * grain + lp(noise(d), 380) * (.5 + heavy) * .6
    e = np.minimum(1, x_t / max(attack, 1e-3)) * np.minimum(1, (d - x_t) / .06) * (1 - .25 * x_t / d)
    return norm(x * e)
def squelch(f=140):
    d = .16; x_t = t_(d)
    return norm(np.sin(2 * np.pi * f * x_t * (1 - .9 * x_t)) * env_exp(d, .05) + lp(noise(d), 900) * env_exp(d, .03) * .5)
def tick(f=3200):
    d = .03; x_t = t_(d)
    return norm(hp(noise(d), 2500) * env_exp(d, .003) + np.sin(2 * np.pi * f * x_t) * env_exp(d, .004) * .4)
def stamp():
    d = .14; x_t = t_(d)
    return norm(lp(noise(d), 1200) * env_exp(d, .012) + np.sin(2 * np.pi * 160 * x_t) * env_exp(d, .03) * .7 + bp(noise(d), 2500, 6000) * env_exp(d, .006) * .4)
def gull(d=.5):
    x_t = t_(d); f = np.interp(x_t, [0, .08, .3, d], [1500, 2300, 1900, 1400])
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) + .4 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    return norm(bp(tone * (1 + .4 * np.sin(2 * np.pi * 28 * x_t)), 900, 5000) * np.sin(np.pi * x_t / d) ** 1.5)

# ---------------- ambience ----------------
def seg_env(a, b, fi, fo): return np.clip(np.minimum((tt - a) / max(fi, 1e-3), (b - tt) / max(fo, 1e-3)), 0, 1)
room = lp(brown(TOT), 240) * .5 + bp(noise(TOT), 150, 900) * .07           # print-shop room tone, the whole film
amb[:, 0] += room * .045; amb[:, 1] += room * .043
wake = evs('wake')[0]['t']                                                   # Beijing wakes up inside the print (J-cut, 0.5 s before the lift):
wind = (lp(noise(TOT), 900) * .6 + bp(noise(TOT), 1500, 5000) * .08) * (.55 + .45 * np.sin(2 * np.pi * .13 * tt + .7) ** 2)   # morning air in old cypresses
wenv = seg_env(wake, 10.6, .9, .4) * (1 - .4 * np.clip((tt - evs('push')[0]['t']) / 1.2, 0, 1))
amb[:, 0] += wind * wenv * .035; amb[:, 1] += np.roll(wind, 900) * wenv * .035
def chirp(d=.09, f0=3800, f1=5200):
    x_t = t_(d); f = np.linspace(f0, f1, len(x_t)); return norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * x_t / d) ** 2)
r2 = np.random.default_rng(4)
for k in range(14):                                                          # sparrows and magpie chatter in the park, panned wide
    t0 = wake + .6 + k * .38 + r2.random() * .2
    for j in range(1 + int(r2.random() * 3)): add(amb, chirp(.06 + .05 * r2.random(), 3000 + 1800 * r2.random(), 3600 + 2200 * r2.random()), t0 + j * .09, .006 + .004 * r2.random(), r2.uniform(-.8, .8))


# each city wakes up inside its print (J-cut a beat before it is printed) and hands over to the next one
WK = {e['place']: e['t'] for e in evs('wake')}
def bed(x, a, b, g, fi=.6, fo=.4, roll=700):
    en = seg_env(a, b, fi, fo); amb[:, 0] += x * en * g; amb[:, 1] += np.roll(x, roll) * en * g
swell = .55 + .45 * np.sin(2 * np.pi * .16 * tt + 1.2) ** 2
water = (lp(noise(TOT), 650) * .7 + bp(noise(TOT), 1200, 4500) * .12) * swell
bed(water, WK['istanbul'], WK['paris'] + .5, .045)                           # Istanbul: the strait, gulls, a ferry horn
for t0, pan, gn in [(WK['istanbul'] + .9, .5, .02), (WK['istanbul'] + 1.7, .3, .014), (WK['istanbul'] + 3.0, -.4, .012)]: add(amb, gull(.45 + .1 * pan), t0, gn, pan)
d = 1.3; x_t = t_(d); horn = (np.sin(2 * np.pi * 146 * x_t) + .5 * np.sin(2 * np.pi * 292 * x_t) + .25 * np.sin(2 * np.pi * 438 * x_t)) * np.minimum(1, x_t / .08) * np.minimum(1, (d - x_t) / .4)
add(amb, lp(horn, 1500), WK['istanbul'] + 1.9, .03, -.5)
street = bp(noise(TOT), 250, 1800) * (.5 + .5 * np.abs(np.sin(2 * np.pi * 2.7 * tt + np.sin(2 * np.pi * .6 * tt) * 3)))
bed(street, WK['paris'], WK['boca'] + .5, .018, roll=2400)                   # Paris: a street murmur, a bicycle bell
d = .5; x_t = t_(d); bell = (np.sin(2 * np.pi * 2350 * x_t) + .6 * np.sin(2 * np.pi * 3720 * x_t)) * np.exp(-x_t / .12)
add(amb, bell, WK['paris'] + 1.6, .02, .4); add(amb, bell, WK['paris'] + 1.78, .016, .4)
breeze = (lp(noise(TOT), 1000) * .6 + bp(noise(TOT), 1500, 5000) * .1) * (.5 + .5 * np.sin(2 * np.pi * .21 * tt) ** 2)
bed(street * .8 + breeze * .5, WK['boca'], evs('silence')[0]['t'] + .2, .02, roll=1800)   # Buenos Aires: street and harbour wind, thinning into the silence
bed(breeze, evs('silence')[0]['t'] - .1, WK['sea'] + .2, .012)                 # the silence: only wind
bed(water * .9 + breeze * .3, WK['sea'], WK['home'] + .6, .05)                  # the night sea
crick = bp(noise(TOT), 4200, 6500) * (np.sin(2 * np.pi * 24 * tt) > .2) * (.5 + .5 * np.sin(2 * np.pi * 1.6 * tt) ** 8)
bed(wind * .7, WK['home'], 52, .03)                                          # home: evening air in the cypresses, then crickets at night
bed(crick, WK['night'], 52, .012, fi=1.2)

# ---------------- foley ----------------
for e in EV:
    t, tp = e['t'], e['type']
    if tp == 'pull':
        d = e['dur']; L = e['layer']
        if L == 'sun':                       # already mid-pull at frame 0: no attack, slower (close-up), bright
            add(fol, scrape(d, 1.0, .3, attack=.003), t, .5, -.1); add(fol, squelch(120), t + .03, .25, 0)
        else:
            n = ['sky1', 'sky2', 'far', 'mid', 'near', 'acc', 'lit', 'sky'].index(L) % 7
            add(fol, scrape(d, 1.0 + .1 * n, .2), t, .42 if L not in ('acc', 'lit') else .3, -.25 + .08 * n)
            add(fol, squelch(150 + 15 * n), t, .18, 0)
    elif tp == 'lift':
        add(fol, clack(.65, 1), t, .3, 0); add(fol, creak(1), t + .04, .16, .2); add(fol, whoosh(.3, 1), t + .02, .1, 0); add(fol, tick(1800), t + .32, .12, .25)
    elif tp == 'stub':
        add(fol, scrape(e['dur'], .9, .6), t, .42, .5); add(fol, squelch(110), t, .2, .5)
    elif tp == 'header':
        add(fol, scrape(.3, 1.2, .3, attack=.004), t, .36, -.5); add(fol, squelch(170), t, .22, -.5); add(fol, thump(1, 95), t + .28, .14, -.4)
    elif tp == 'item':
        add(fol, stamp(), t, .55 if not e.get('accent') else .7, .5); add(fol, tick(2400), t, .18, .5)
    elif tp == 'sign':
        add(fol, scrape(.24, 1.3, .2, attack=.004), t, .25, .4); add(fol, stamp(), t + .22, .3, .4)
    elif tp == 'wipe':
        add(fol, whoosh(.6, 1), t, .2, 0); add(fol, bp(noise(.5), 1500, 7000) * np.sin(np.pi * t_(.5) / .5) ** 1.5, t + .05, .05, .3)
    elif tp == 'sweep':
        add(fol, scrape(e['dur'] + .1, .85, .8), t, .62, 0); add(fol, squelch(95), t, .35, 0)
        if e.get('fountain'): add(fol, squelch(130), t + .08, .25, -.3); add(fol, squelch(160), t + .16, .2, .3)
    elif tp == 'crane':
        add(fol, whoosh(1.6, 1), t + .2, .05, 0)
        for k in range(5): add(fol, bp(noise(.35), 900, 4200) * np.sin(np.pi * t_(.35) / .35) ** 2, t + .4 + k * .6, .06, -.4 + .2 * k)
    elif tp == 'truck':
        add(fol, whoosh(min(2.4, e['dur']), 1), t + .2, .045, 0)
    elif tp == 'bigpush':
        add(fol, whoosh(1.4, 1), t + .3, .05, 0)
    elif tp == 'meshdown':
        add(fol, creak(1), t, .14, .2); add(fol, clack(.6, 1), t + e['dur'], .22, 0)
    elif tp == 'clamp':
        d = .6; x_t = t_(d)
        wood = sum(a * np.sin(2 * np.pi * f * x_t) * env_exp(d, tau) for f, a, tau in [(520, 1, .03), (1180, .6, .02), (240, .8, .05)])
        metal = sum(a * np.sin(2 * np.pi * f * x_t) * env_exp(d, tau) for f, a, tau in [(2410, .5, .18), (3890, .3, .12), (5230, .18, .08)])
        add(fol, norm(wood + metal + hp(noise(d), 3000) * env_exp(d, .002) * 1.2), t, 1.0, 0); add(fol, thump(1, 60), t, .5, 0)
    elif tp == 'snap':
        d = .6; x_t = t_(d)
        wood = sum(a * np.sin(2 * np.pi * f * x_t) * env_exp(d, tau) for f, a, tau in [(480, 1, .03), (1100, .6, .02), (220, .9, .06)])
        add(fol, norm(wood + hp(noise(d), 3000) * env_exp(d, .002)), t, 1.0, 0); add(fol, thump(1, 55), t, .6, 0)
    elif tp == 'count':
        n = int(e['dur'] / .09)
        for k in range(n): u = k / n; add(fol, tick(2600 + 600 * u), t + e['dur'] * (1 - (1 - u) ** 1.0) , .05 + .02 * u, .55)
    elif tp == 'pullout':
        add(fol, whoosh(1.0, 1), t, .07, 0)
    elif tp == 'endpull':
        add(fol, scrape(e['dur'], 1.1, .4), t, .45, .5); add(fol, squelch(120), t, .22, .5)
    elif tp == 'push':
        add(fol, whoosh(.9, 1), t + .05, .06, 0)

# ---------------- voice ----------------
cues = json.load(open(os.path.join(D, 'voice/cues.json')))
for c in cues:
    x, sr = sf.read(os.path.join(D, 'out', 'voice', c['id'] + '.wav'))
    if x.ndim > 1: x = x.mean(1)
    x = resample_poly(x, SR, sr) if sr != SR else x
    x = hp(x, 80)
    x = compress(x / (np.abs(x).max() + 1e-9) * .9, thr=.22, ratio=3.0, att=.003, rel=.09)
    add(vox, x, c['vo'], 1.0, 0)

# ---------------- music ----------------
mus, sr = sf.read(os.path.join(D, 'music/score.wav'), always_2d=True)
m = np.zeros((N, 2)); L = min(N, len(mus)); m[:L] = mus[:L]
# make room for the voice: dip 300 Hz–4 kHz by ~4 dB all the time
mid = np.stack([bp(m[:, c], 300, 4000) for c in range(2)], 1)
m = m - mid * .37
# duck a further ~3 dB under speech
ve = np.abs(vox).max(1); ve = uniform_filter1d(maximum_filter1d(ve, int(.25 * SR)), int(.12 * SR))
duck = 1 - .3 * np.clip(ve / (ve.max() + 1e-9) * 4, 0, 1)
m *= duck[:, None]

# balance: voice RMS (where speaking) ~10 dB above music RMS (where music plays) in this stretch
a0, b0 = int(A * SR), int(Bt * SR)
def rms(x, mask): return np.sqrt((x[mask] ** 2).mean() + 1e-12)
vmask = np.zeros(N, bool)
for c in cues:
    s0, s1 = int(c['vo'] * SR), int((c['vo'] + c['speech']) * SR); vmask[max(s0, a0):min(s1, b0)] = True
mmask = np.zeros(N, bool); mmask[a0:b0] = True; mmask &= np.abs(m).max(1) > 1e-4
vr, mr = rms(vox.mean(1), vmask), rms(m.mean(1), mmask)
mg = (vr / mr) / (10 ** (10 / 20))
m *= mg
for e in evs('silence'):
    a_, b_ = int((e['t'] + .02) * SR), int((e['t'] + e['dur'] - .005) * SR)
    m[a_:b_] = 0; fol[a_:b_] = 0
mix = m + fol * .55 + amb + vox
seg = mix[a0:b0 + int(.05 * SR)].copy()[:b0 - a0]
fo = int(.35 * SR); seg[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5      # a short fade at the very end of the span
for c in range(2): seg[:, c] = limit(seg[:, c], .92)
assert np.isfinite(seg).all()
os.makedirs(os.path.join(D, 'out'), exist_ok=True)
sf.write(os.path.join(D, 'out/mix.wav'), seg.astype(np.float32), SR, subtype='FLOAT')
vr2 = 20 * np.log10(rms(vox.mean(1), vmask)); mr2 = 20 * np.log10(rms(m.mean(1), mmask))
print(f'mix.wav {A}-{Bt}s  voice rms {vr2:.1f} dB  music rms {mr2:.1f} dB  (gap {vr2 - mr2:.1f} dB)  peak {20*np.log10(np.abs(seg).max()):.1f} dBFS')
